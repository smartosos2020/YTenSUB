import type { KVNamespace, R2Bucket } from '@cloudflare/workers-types'
import {
  CardRecord,
  CuratedPrefs,
  Entitlement,
  Plan,
  UserChannel,
  UserRecord,
  applyCard,
  chooseMailProvider,
  effectivePlan,
  grantPlan,
  isValidCardCode,
  isValidEmail,
  isValidVideoId,
  makeCardCode,
  mergePrefs,
  normalizeCardCode,
  normalizeChannelHandle,
  revokePlan,
  sanitizeAnnounce,
  sanitizePrefs,
  toEntitlement
} from './logic'
import { ADMIN_PAGE } from './admin-page'
import { readSession, writeSession } from './session'
import { isMetadataKey, readContent, writeContent } from './content'

/**
 * YTenSUB 账号/权益 API（Cloudflare Workers + 单 KV 命名空间，键全带前缀）。
 *
 * KV 键布局：
 *   code:<email>      登录验证码 {code}，TTL 10 分钟
 *   rl:code:<email>   发码限流，TTL 60 秒
 *   token:<token>     会话 → email，metadata.expiresAt；有效期 30 天，剩余 ≤7 天时续期
 *   user:<email>      UserRecord（档位/到期）
 *   pref:<email>      CuratedPrefs（精选偏好随账号同步，PUT 需付费档）
 *   card:<code>       CardRecord
 *   uchan:<handle>    UserChannel（用户频道订阅：pending/approved/rejected，approved 进管线）
 *   config:graceDays  离线宽限天数（默认 7，Dashboard/CLI 改）
 *
 * Secrets（wrangler secret put / .dev.vars）：EMAIL_FROM + 二选一 RESEND_API_KEY（需自有域名）或 SENDGRID_API_KEY（单发件人验证即可）；ADMIN_TOKEN
 * Vars：DEV_MODE=true 时 /auth/code 直接在响应里返回 devCode（仅本地调试用）
 */
export interface Env {
  YTENSUB_KV: KVNamespace
  CONTENT_BUCKET: R2Bucket
  CONTENT_UPLOAD_TOKEN?: string
  RESEND_API_KEY?: string
  SENDGRID_API_KEY?: string
  EMAIL_FROM?: string
  ADMIN_TOKEN?: string
  /** Optional production token override for local admin saves; defaults to ADMIN_TOKEN. */
  PRODUCTION_ADMIN_TOKEN?: string
  DEV_MODE?: string
}

const CODE_TTL_S = 600
const DEFAULT_GRACE_DAYS = 7
const PRODUCTION_API_URL = 'https://ytensub-api.smartosos2020.workers.dev'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors() }
  })
}

function cors(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, If-None-Match',
    'Access-Control-Expose-Headers': 'ETag, Last-Modified'
  }
}

function bearer(req: Request): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get('Authorization') ?? '')
  return m ? m[1].trim() : null
}

async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T
  } catch {
    return null
  }
}

async function graceDays(env: Env): Promise<number> {
  const v = await env.YTENSUB_KV.get('config:graceDays')
  const n = v ? parseInt(v, 10) : NaN
  return Number.isFinite(n) && n >= 0 && n <= 90 ? n : DEFAULT_GRACE_DAYS
}

/** 全局敏感过滤开关（默认开=fail closed）；用户级覆盖在 resolveFilterSensitive 里叠加 */
async function globalFilterSensitive(env: Env): Promise<boolean> {
  return (await env.YTENSUB_KV.get('config:filter-sensitive')) !== '0'
}

async function getUser(env: Env, email: string): Promise<UserRecord | null> {
  return (await env.YTENSUB_KV.get(`user:${email}`, 'json')) as UserRecord | null
}

/** Bearer token → 用户记录；临近到期时续期，普通读取不写 KV。 */
async function authUser(env: Env, req: Request): Promise<UserRecord | null> {
  const token = bearer(req)
  if (!token) return null
  const email = await readSession(env.YTENSUB_KV, token)
  if (!email) return null
  return getUser(env, email)
}

async function sendCodeEmail(env: Env, email: string, code: string): Promise<boolean> {
  if (!env.EMAIL_FROM) return false
  const subject = `YTenSUB 验证码：${code}`
  const text = `您的 YTenSUB 登录验证码是 ${code}，10 分钟内有效。若非本人操作请忽略。`
  switch (chooseMailProvider(env)) {
    case 'resend': {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ from: env.EMAIL_FROM, to: email, subject, text })
      })
      return r.ok
    }
    case 'sendgrid': {
      // Single Sender Verification：发件人只需是已验证邮箱，无需自有域名
      const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.SENDGRID_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email }] }],
          from: { email: env.EMAIL_FROM },
          subject,
          content: [{ type: 'text/plain', value: text }]
        })
      })
      return r.ok || r.status === 202
    }
    default:
      return false
  }
}

// ---------- 公开接口 ----------

async function handleAuthCode(env: Env, req: Request): Promise<Response> {
  const body = await readJson<{ email?: string }>(req)
  const email = body?.email?.trim().toLowerCase() ?? ''
  if (!isValidEmail(email)) return json({ error: 'invalid email' }, 400)
  if (await env.YTENSUB_KV.get(`rl:code:${email}`)) {
    return json({ error: 'too frequent, retry in 60s' }, 429)
  }
  const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')
  await env.YTENSUB_KV.put(`code:${email}`, JSON.stringify({ code }), { expirationTtl: CODE_TTL_S })
  await env.YTENSUB_KV.put(`rl:code:${email}`, '1', { expirationTtl: 60 })
  const sent = await sendCodeEmail(env, email, code)
  if (!sent && env.DEV_MODE !== 'true') return json({ error: 'email not configured' }, 500)
  // DEV_MODE：本地调试没配邮件服务时直接把码带回，省得查 KV
  return json(env.DEV_MODE === 'true' ? { ok: true, devCode: code } : { ok: true })
}

async function handleLogin(env: Env, req: Request): Promise<Response> {
  const body = await readJson<{ email?: string; code?: string }>(req)
  const email = body?.email?.trim().toLowerCase() ?? ''
  const code = body?.code?.trim() ?? ''
  if (!isValidEmail(email) || !/^\d{6}$/.test(code)) return json({ error: 'bad request' }, 400)
  const stored = await env.YTENSUB_KV.get(`code:${email}`, 'json') as { code: string } | null
  if (!stored || stored.code !== code) return json({ error: 'wrong or expired code' }, 401)
  await env.YTENSUB_KV.delete(`code:${email}`)

  const now = Date.now()
  let user = await getUser(env, email)
  if (!user) {
    user = { email, plan: 'free', expiresAt: null, createdAt: now, updatedAt: now }
    await env.YTENSUB_KV.put(`user:${email}`, JSON.stringify(user))
  }
  const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '')
  await writeSession(env.YTENSUB_KV, token, email, now)
  return json({ token, entitlement: toEntitlement(user, now, await graceDays(env), await globalFilterSensitive(env)) })
}

async function handleRedeem(env: Env, req: Request): Promise<Response> {
  const user = await authUser(env, req)
  if (!user) return json({ error: 'unauthorized' }, 401)
  const body = await readJson<{ code?: string }>(req)
  const code = normalizeCardCode(body?.code ?? '')
  if (!isValidCardCode(code)) return json({ error: 'bad code format' }, 400)
  const card = (await env.YTENSUB_KV.get(`card:${code}`, 'json')) as CardRecord | null
  if (!card) return json({ error: 'card not found' }, 404)
  // 幂等：同一用户重复兑同一张卡按成功处理（网络丢响应重试的场景，防"卡被吞"）
  if (card.usedAt) {
    if (card.usedBy === user.email) {
      return json({ entitlement: toEntitlement(user, Date.now(), await graceDays(env), await globalFilterSensitive(env)), alreadyRedeemed: true })
    }
    return json({ error: 'card already used' }, 409)
  }

  const now = Date.now()
  const updated = applyCard(user, card, now)
  card.usedBy = user.email
  card.usedAt = now
  await env.YTENSUB_KV.put(`user:${user.email}`, JSON.stringify(updated))
  await env.YTENSUB_KV.put(`card:${code}`, JSON.stringify(card))
  return json({ entitlement: toEntitlement(updated, now, await graceDays(env), await globalFilterSensitive(env)) })
}

async function handleEntitlement(env: Env, req: Request): Promise<Response> {
  const user = await authUser(env, req)
  if (!user) return json({ error: 'unauthorized' }, 401)
  return json({ entitlement: toEntitlement(user, Date.now(), await graceDays(env), await globalFilterSensitive(env)) })
}

// ---------- 偏好随账号同步（B4，付费功能） ----------

async function handlePrefsGet(env: Env, req: Request): Promise<Response> {
  const user = await authUser(env, req)
  if (!user) return json({ error: 'unauthorized' }, 401)
  const prefs = (await env.YTENSUB_KV.get(`pref:${user.email}`, 'json')) as CuratedPrefs | null
  return json({ prefs })
}

async function handlePrefsPut(env: Env, req: Request): Promise<Response> {
  const user = await authUser(env, req)
  if (!user) return json({ error: 'unauthorized' }, 401)
  // 服务端强制付费档（防客户端绕过）；到期回落 free 后自动不可写
  if (effectivePlan(user, Date.now()) === 'free') return json({ error: 'pro feature' }, 403)
  const prefs = sanitizePrefs(await readJson<unknown>(req), Date.now())
  if (!prefs) return json({ error: 'bad prefs' }, 400)
  // 旧值更新才覆盖（客户端乱序重试不丢新数据）
  const cur = (await env.YTENSUB_KV.get(`pref:${user.email}`, 'json')) as CuratedPrefs | null
  const merged = mergePrefs(prefs, cur)
  await env.YTENSUB_KV.put(`pref:${user.email}`, JSON.stringify(merged))
  return json({ prefs: merged })
}

// ---------- C1 用户频道订阅（pro 起；审核后进管线） ----------

async function handleChannelSubmit(env: Env, req: Request): Promise<Response> {
  const user = await authUser(env, req)
  if (!user) return json({ error: 'unauthorized' }, 401)
  if (effectivePlan(user, Date.now()) === 'free') return json({ error: 'pro feature' }, 403)
  const body = await readJson<{ handle?: string }>(req)
  const handle = normalizeChannelHandle(body?.handle ?? '')
  if (!handle) return json({ error: 'bad channel handle' }, 400)
  const key = `uchan:${handle}`
  const cur = (await env.YTENSUB_KV.get(key, 'json')) as UserChannel | null
  if (cur?.status === 'approved') return json({ ok: true, status: 'approved' })
  const rec: UserChannel = { handle, submittedBy: user.email, submittedAt: Date.now(), status: 'pending' }
  await env.YTENSUB_KV.put(key, JSON.stringify(rec))
  return json({ ok: true, status: 'pending' })
}

async function handleAdminChannelsList(env: Env, req: Request): Promise<Response> {
  const status = new URL(req.url).searchParams.get('status')
  const list = await env.YTENSUB_KV.list({ prefix: 'uchan:', limit: 500 })
  const channels: UserChannel[] = []
  for (const k of list.keys) {
    const c = (await env.YTENSUB_KV.get(k.name, 'json')) as UserChannel | null
    if (c && (!status || c.status === status)) channels.push(c)
  }
  channels.sort((a, b) => b.submittedAt - a.submittedAt)
  return json({ channels })
}

interface ContentPipelineStatus {
  state: 'running' | 'success' | 'failed'
  startedAt: number
  updatedAt: number
  finishedAt?: number
  added?: number
  total?: number
  published?: boolean
  message?: string
}

async function handleAdminContentStatusGet(env: Env): Promise<Response> {
  const status = await env.YTENSUB_KV.get('content:pipeline-status', 'json')
  return json({ status })
}

async function handleAdminContentStatusSet(env: Env, req: Request): Promise<Response> {
  const body = await readJson<Partial<ContentPipelineStatus>>(req)
  if (!body || !['running', 'success', 'failed'].includes(body.state ?? '')) {
    return json({ error: 'bad pipeline status' }, 400)
  }
  if (!Number.isFinite(body.startedAt) || (body.startedAt ?? 0) <= 0) {
    return json({ error: 'bad startedAt' }, 400)
  }
  const status: ContentPipelineStatus = {
    state: body.state as ContentPipelineStatus['state'],
    startedAt: body.startedAt!,
    updatedAt: Date.now(),
    ...(Number.isFinite(body.finishedAt) ? { finishedAt: body.finishedAt } : {}),
    ...(Number.isFinite(body.added) ? { added: Math.max(0, Math.floor(body.added!)) } : {}),
    ...(Number.isFinite(body.total) ? { total: Math.max(0, Math.floor(body.total!)) } : {}),
    ...(typeof body.published === 'boolean' ? { published: body.published } : {}),
    ...(typeof body.message === 'string' ? { message: body.message.slice(0, 500) } : {})
  }
  await env.YTENSUB_KV.put('content:pipeline-status', JSON.stringify(status))
  return json({ ok: true, status })
}

async function handleAdminChannelDecide(env: Env, req: Request): Promise<Response> {
  const body = await readJson<{ handle?: string; status?: string }>(req)
  const handle = normalizeChannelHandle(body?.handle ?? '')
  const status = body?.status === 'approved' || body?.status === 'rejected' ? body.status : null
  if (!handle || !status) return json({ error: 'bad request' }, 400)
  const key = `uchan:${handle}`
  const cur = (await env.YTENSUB_KV.get(key, 'json')) as UserChannel | null
  if (!cur) return json({ error: 'not found' }, 404)
  cur.status = status
  await env.YTENSUB_KV.put(key, JSON.stringify(cur))
  return json({ ok: true })
}

// ---------- C2 pro+ 精选字幕下发（D4 的 C 路线：双闸门之服务端闸） ----------

async function handleCues(env: Env, req: Request, videoId: string): Promise<Response> {
  const user = await authUser(env, req)
  if (!user) return json({ error: 'unauthorized' }, 401)
  if (effectivePlan(user, Date.now()) !== 'pro_plus') return json({ error: 'pro_plus feature' }, 403)
  if (!isValidVideoId(videoId)) return json({ error: 'bad videoId' }, 400)
  return readContent(env.CONTENT_BUCKET, req, `cues/${videoId}.json`, true)
}

// ---------- 公告文案（「我的」页底部胶囊块；公开读、管理页写） ----------

async function handleAnnounceGet(env: Env): Promise<Response> {
  const text = await env.YTENSUB_KV.get('config:announce')
  return json({ text: text ?? '' })
}

// ---------- 敏感内容过滤开关（全局，admin 控制，客户端无感；默认开=fail closed） ----------

async function handleFilterSensitiveGet(env: Env): Promise<Response> {
  const v = await env.YTENSUB_KV.get('config:filter-sensitive')
  return json({ on: v !== '0' })
}

type CloudflareSyncResult =
  | { attempted: false }
  | { attempted: true; synced: true }
  | { attempted: true; synced: false; error: string }

/** Local admin saves must mirror configuration/user overrides into production KV. */
async function syncLocalAdminChangeToCloudflare(
  env: Env,
  req: Request,
  path: string,
  body: unknown,
  verify: (response: Record<string, unknown>) => boolean
): Promise<CloudflareSyncResult> {
  // Only Wrangler localhost requests proxy. A deployed Worker writes directly to
  // its bound production KV and must never call itself recursively.
  const hostname = new URL(req.url).hostname.replace(/^\[|\]$/g, '')
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  if (!isLocal) return { attempted: false }

  const token = env.PRODUCTION_ADMIN_TOKEN || env.ADMIN_TOKEN
  if (!token) {
    return {
      attempted: true,
      synced: false,
      error: 'missing PRODUCTION_ADMIN_TOKEN or ADMIN_TOKEN'
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const upstream = await fetch(`${PRODUCTION_API_URL}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    })
    if (!upstream.ok) {
      const error = upstream.status === 401
        ? 'production rejected the admin token; set PRODUCTION_ADMIN_TOKEN in server/.dev.vars'
        : `production API returned HTTP ${upstream.status}`
      return { attempted: true, synced: false, error }
    }
    const result = await upstream.json() as Record<string, unknown>
    if (!verify(result)) {
      return { attempted: true, synced: false, error: 'Cloudflare sync could not be verified' }
    }
    return { attempted: true, synced: true }
  } catch {
    return { attempted: true, synced: false, error: 'network error or timeout' }
  } finally {
    clearTimeout(timer)
  }
}

async function handleAdminFilterSensitiveSet(env: Env, req: Request): Promise<Response> {
  const body = await readJson<{ on?: unknown }>(req)
  if (typeof body?.on !== 'boolean') return json({ error: 'bad request' }, 400)
  await env.YTENSUB_KV.put('config:filter-sensitive', body.on ? '1' : '0')
  const sync = await syncLocalAdminChangeToCloudflare(
    env, req, '/admin/filter-sensitive', { on: body.on },
    (result) => result.on === body.on
  )
  if (sync.attempted && !sync.synced) {
    return json({ error: `saved locally, but Cloudflare sync failed: ${sync.error}` }, 502)
  }
  return json({ ok: true, on: body.on, ...(sync.attempted ? { cloudflareSynced: true } : {}) })
}

async function handleAdminAnnounceSet(env: Env, req: Request): Promise<Response> {
  const body = await readJson<{ text?: unknown }>(req)
  if (typeof body?.text !== 'string') return json({ error: 'bad request' }, 400)
  const text = sanitizeAnnounce(body.text)
  await env.YTENSUB_KV.put('config:announce', text ?? '')
  return json({ ok: true, text: text ?? '' })
}

// ---------- 管理接口（A4；admin token 认证） ----------

function adminOk(env: Env, req: Request): boolean {
  const token = bearer(req)
  return !!env.ADMIN_TOKEN && !!token && token === env.ADMIN_TOKEN
}

async function handleAdminCardsCreate(env: Env, req: Request): Promise<Response> {
  const body = await readJson<{ plan?: string; days?: number; count?: number }>(req)
  const plan = body?.plan === 'pro_plus' ? 'pro_plus' : body?.plan === 'pro' ? 'pro' : null
  const days = Math.floor(body?.days ?? 0)
  const count = Math.min(Math.max(Math.floor(body?.count ?? 1), 1), 100)
  if (!plan || days <= 0 || days > 3650) return json({ error: 'bad plan/days' }, 400)
  const codes: string[] = []
  for (let i = 0; i < count; i++) {
    const code = makeCardCode(Math.random)
    const card: CardRecord = { code, plan, days }
    await env.YTENSUB_KV.put(`card:${code}`, JSON.stringify(card))
    codes.push(code)
  }
  return json({ codes })
}

async function handleAdminCardsList(env: Env, req: Request): Promise<Response> {
  const url = new URL(req.url)
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '100', 10) || 100, 500)
  const list = await env.YTENSUB_KV.list({ prefix: 'card:', limit })
  const cards: CardRecord[] = []
  for (const k of list.keys) {
    const c = (await env.YTENSUB_KV.get(k.name, 'json')) as CardRecord | null
    if (c) cards.push(c)
  }
  cards.sort((a, b) => (b.usedAt ?? 0) - (a.usedAt ?? 0))
  return json({ cards })
}

async function handleAdminUserLookup(env: Env, req: Request): Promise<Response> {
  const email = (new URL(req.url).searchParams.get('email') ?? '').trim().toLowerCase()
  if (!isValidEmail(email)) return json({ error: 'invalid email' }, 400)
  const user = await getUser(env, email)
  if (!user) return json({ user: null })
  return json({ user, entitlement: toEntitlement(user, Date.now(), await graceDays(env), await globalFilterSensitive(env)) })
}

/** 用户级过滤覆盖：mode = inherit（跟随全局）/ on（强制开）/ off（强制关） */
async function handleAdminUserFilterSet(env: Env, req: Request): Promise<Response> {
  const body = await readJson<{ email?: string; mode?: string }>(req)
  const email = body?.email?.trim().toLowerCase() ?? ''
  if (!isValidEmail(email)) return json({ error: 'invalid email' }, 400)
  const mode = body?.mode
  if (mode !== 'inherit' && mode !== 'on' && mode !== 'off') return json({ error: 'bad mode' }, 400)
  const user = await getUser(env, email)
  if (!user) return json({ error: 'user not found' }, 404)
  user.filterSensitive = mode === 'inherit' ? null : mode === 'on'
  user.updatedAt = Date.now()
  await env.YTENSUB_KV.put(`user:${email}`, JSON.stringify(user))
  const sync = await syncLocalAdminChangeToCloudflare(
    env, req, '/admin/user/filter', { email, mode },
    (result) => result.filterSensitive === user.filterSensitive
  )
  if (sync.attempted && !sync.synced) {
    return json({ error: `saved locally, but Cloudflare sync failed: ${sync.error}` }, 502)
  }
  return json({
    ok: true,
    filterSensitive: user.filterSensitive,
    ...(sync.attempted ? { cloudflareSynced: true } : {})
  })
}

/** 会员列表（会员管理模块）：KV 前缀扫描 + 逐条解析生效权益 */
async function handleAdminUsersList(env: Env, req: Request): Promise<Response> {
  const url = new URL(req.url)
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '200', 10) || 200, 500)
  const list = await env.YTENSUB_KV.list({ prefix: 'user:', limit })
  const gd = await graceDays(env)
  const gfs = await globalFilterSensitive(env)
  const now = Date.now()
  const users: { user: UserRecord; entitlement: Entitlement }[] = []
  for (const k of list.keys) {
    const u = (await env.YTENSUB_KV.get(k.name, 'json')) as UserRecord | null
    if (u) users.push({ user: u, entitlement: toEntitlement(u, now, gd, gfs) })
  }
  users.sort((a, b) => (b.entitlement.expiresAt ?? 0) - (a.entitlement.expiresAt ?? 0))
  return json({ users })
}

/** 手动开通/顺延（plan=pro/pro_plus + days）或吊销（plan=free） */
async function handleAdminUserPlanSet(env: Env, req: Request): Promise<Response> {
  const body = await readJson<{ email?: string; plan?: string; days?: number }>(req)
  const email = body?.email?.trim().toLowerCase() ?? ''
  if (!isValidEmail(email)) return json({ error: 'invalid email' }, 400)
  const user = await getUser(env, email)
  if (!user) return json({ error: 'user not found' }, 404)
  const now = Date.now()
  let updated: UserRecord
  if (body?.plan === 'free') {
    updated = revokePlan(user, now)
  } else if (body?.plan === 'pro' || body?.plan === 'pro_plus') {
    const days = Math.floor(body?.days ?? 0)
    if (days <= 0 || days > 3650) return json({ error: 'bad days' }, 400)
    updated = grantPlan(user, body.plan, days, now)
  } else {
    return json({ error: 'bad plan' }, 400)
  }
  await env.YTENSUB_KV.put(`user:${email}`, JSON.stringify(updated))
  return json({
    ok: true,
    entitlement: toEntitlement(updated, now, await graceDays(env), await globalFilterSensitive(env))
  })
}

/** 吊销未使用的卡密（已用的不删，留档） */
async function handleAdminCardRevoke(env: Env, req: Request): Promise<Response> {
  const body = await readJson<{ code?: string }>(req)
  const code = normalizeCardCode(body?.code ?? '')
  if (!isValidCardCode(code)) return json({ error: 'bad code format' }, 400)
  const key = `card:${code}`
  const card = (await env.YTENSUB_KV.get(key, 'json')) as CardRecord | null
  if (!card) return json({ error: 'not found' }, 404)
  if (card.usedAt) return json({ error: 'card already used, keep for record' }, 409)
  await env.YTENSUB_KV.delete(key)
  return json({ ok: true })
}

/** 设置模块：读全局配置 */
async function handleAdminConfigGet(env: Env): Promise<Response> {
  return json({
    graceDays: await graceDays(env),
    filterSensitive: await globalFilterSensitive(env),
    announce: (await env.YTENSUB_KV.get('config:announce')) ?? ''
  })
}

/** 设置模块：改离线宽限天数（0–90） */
async function handleAdminGraceDaysSet(env: Env, req: Request): Promise<Response> {
  const body = await readJson<{ days?: number }>(req)
  const days = Math.floor(body?.days ?? NaN)
  if (!Number.isFinite(days) || days < 0 || days > 90) return json({ error: 'days 0-90' }, 400)
  await env.YTENSUB_KV.put('config:graceDays', String(days))
  return json({ ok: true, graceDays: days })
}

// ---------- 路由 ----------

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    const { pathname } = url
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() })

    try {
      if (pathname === '/health') return json({ ok: true })
      if (pathname.startsWith('/content/') && (req.method === 'GET' || req.method === 'HEAD')) {
        const key = pathname.slice('/content/'.length)
        if (!isMetadataKey(key)) return json({ error: 'not found' }, 404)
        return await readContent(env.CONTENT_BUCKET, req, key)
      }
      if (pathname.startsWith('/admin/content/')) {
        const token = bearer(req)
        if (!adminOk(env, req) && !(env.CONTENT_UPLOAD_TOKEN && token === env.CONTENT_UPLOAD_TOKEN)) {
          return json({ error: 'unauthorized' }, 401)
        }
        const key = pathname.slice('/admin/content/'.length)
        if (req.method === 'PUT') return await writeContent(env.CONTENT_BUCKET, req, key)
        if (req.method === 'GET' || req.method === 'HEAD') return await readContent(env.CONTENT_BUCKET, req, key, true)
        return json({ error: 'method not allowed' }, 405)
      }
      if (pathname === '/announce' && req.method === 'GET') return await handleAnnounceGet(env)
      if (pathname === '/config/filter-sensitive' && req.method === 'GET') {
        return await handleFilterSensitiveGet(env)
      }
      if (pathname === '/auth/code' && req.method === 'POST') return await handleAuthCode(env, req)
      if (pathname === '/auth/login' && req.method === 'POST') return await handleLogin(env, req)
      if (pathname === '/redeem' && req.method === 'POST') return await handleRedeem(env, req)
      if (pathname === '/me/entitlement' && req.method === 'GET') return await handleEntitlement(env, req)
      if (pathname === '/me/prefs' && req.method === 'GET') return await handlePrefsGet(env, req)
      if (pathname === '/me/prefs' && req.method === 'PUT') return await handlePrefsPut(env, req)
      if (pathname === '/channels/submit' && req.method === 'POST') return await handleChannelSubmit(env, req)
      const cuesMatch = /^\/cues\/([\w-]{11})$/.exec(pathname)
      if (cuesMatch && req.method === 'GET') return await handleCues(env, req, cuesMatch[1])

      if (pathname === '/admin' && req.method === 'GET') {
        return new Response(ADMIN_PAGE, {
          headers: { 'Content-Type': 'text/html; charset=utf-8', ...cors() }
        })
      }
      if (pathname === '/admin/cards' && req.method === 'POST') {
        if (!adminOk(env, req)) return json({ error: 'unauthorized' }, 401)
        return await handleAdminCardsCreate(env, req)
      }
      if (pathname === '/admin/cards' && req.method === 'GET') {
        if (!adminOk(env, req)) return json({ error: 'unauthorized' }, 401)
        return await handleAdminCardsList(env, req)
      }
      if (pathname === '/admin/user' && req.method === 'GET') {
        if (!adminOk(env, req)) return json({ error: 'unauthorized' }, 401)
        return await handleAdminUserLookup(env, req)
      }
      if (pathname === '/admin/channels' && req.method === 'GET') {
        if (!adminOk(env, req)) return json({ error: 'unauthorized' }, 401)
        return await handleAdminChannelsList(env, req)
      }
      if (pathname === '/admin/content-status' && req.method === 'GET') {
        if (!adminOk(env, req)) return json({ error: 'unauthorized' }, 401)
        return await handleAdminContentStatusGet(env)
      }
      if (pathname === '/admin/content-status' && req.method === 'POST') {
        if (!adminOk(env, req)) return json({ error: 'unauthorized' }, 401)
        return await handleAdminContentStatusSet(env, req)
      }
      if (pathname === '/admin/channels/decide' && req.method === 'POST') {
        if (!adminOk(env, req)) return json({ error: 'unauthorized' }, 401)
        return await handleAdminChannelDecide(env, req)
      }
      if (pathname === '/admin/announce' && req.method === 'POST') {
        if (!adminOk(env, req)) return json({ error: 'unauthorized' }, 401)
        return await handleAdminAnnounceSet(env, req)
      }
      if (pathname === '/admin/filter-sensitive' && req.method === 'POST') {
        if (!adminOk(env, req)) return json({ error: 'unauthorized' }, 401)
        return await handleAdminFilterSensitiveSet(env, req)
      }
      if (pathname === '/admin/user/filter' && req.method === 'POST') {
        if (!adminOk(env, req)) return json({ error: 'unauthorized' }, 401)
        return await handleAdminUserFilterSet(env, req)
      }
      if (pathname === '/admin/users' && req.method === 'GET') {
        if (!adminOk(env, req)) return json({ error: 'unauthorized' }, 401)
        return await handleAdminUsersList(env, req)
      }
      if (pathname === '/admin/user/plan' && req.method === 'POST') {
        if (!adminOk(env, req)) return json({ error: 'unauthorized' }, 401)
        return await handleAdminUserPlanSet(env, req)
      }
      if (pathname === '/admin/cards/revoke' && req.method === 'POST') {
        if (!adminOk(env, req)) return json({ error: 'unauthorized' }, 401)
        return await handleAdminCardRevoke(env, req)
      }
      if (pathname === '/admin/config' && req.method === 'GET') {
        if (!adminOk(env, req)) return json({ error: 'unauthorized' }, 401)
        return await handleAdminConfigGet(env)
      }
      if (pathname === '/admin/config/grace-days' && req.method === 'POST') {
        if (!adminOk(env, req)) return json({ error: 'unauthorized' }, 401)
        return await handleAdminGraceDaysSet(env, req)
      }
      return json({ error: 'not found' }, 404)
    } catch (e) {
      return json({ error: 'internal', detail: String(e) }, 500)
    }
  }
}

export type { Entitlement, Plan }
