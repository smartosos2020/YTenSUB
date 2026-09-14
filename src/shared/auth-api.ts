/**
 * 账号/权益 API 客户端（对应 server/ 的 Workers 接口）。
 * 桌面渲染进程与手机端共用同一契约；手机端若不便引用本目录，可在 mobile/src/lib/ 放同步拷贝。
 */

export type Plan = 'free' | 'pro' | 'pro_plus'

export interface Entitlement {
  plan: Plan
  /** 到期时间（ms）；null = 从未付费 */
  expiresAt: number | null
  /** 离线宽限天数（服务端可调，D5） */
  graceDays: number
  /** 敏感内容过滤生效值（服务端已解析：用户级覆盖 > 全局开关）；旧版本缓存可能缺省，缺省按 true 处理 */
  filterSensitive?: boolean
}

export interface AuthSession {
  email: string
  token: string
}

/** 生产 API 地址。本地联调时临时改为 http://127.0.0.1:8787（wrangler dev），别提交本地地址 */
export const AUTH_API_URL = 'https://ytensub-api.smartosos2020.workers.dev'

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>

async function call<T>(
  fetchFn: FetchFn,
  method: string,
  path: string,
  body?: unknown,
  token?: string
): Promise<T> {
  let r: Response
  try {
    r = await fetchFn(AUTH_API_URL + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  } catch {
    throw new Error('网络异常，请检查网络/代理后重试')
  }
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>
  if (!r.ok) throw new Error(typeof data.error === 'string' ? data.error : `请求失败（${r.status}）`)
  return data as T
}

/** 发送登录验证码；DEV_MODE 下响应带 devCode */
export function requestCode(email: string, fetchFn: FetchFn = fetch) {
  return call<{ ok: true; devCode?: string }>(fetchFn, 'POST', '/auth/code', { email })
}

/** 验证码登录，返回会话 + 当前权益 */
export function login(email: string, code: string, fetchFn: FetchFn = fetch) {
  return call<{ token: string; entitlement: Entitlement }>(fetchFn, 'POST', '/auth/login', {
    email,
    code
  })
}

/** 兑换卡密，返回兑换后的权益 */
export function redeemCard(token: string, code: string, fetchFn: FetchFn = fetch) {
  return call<{ entitlement: Entitlement }>(fetchFn, 'POST', '/redeem', { code }, token)
}

/** 拉取当前权益（启动/打开精选页时调用，本地按 graceDays 宽限缓存） */
export function fetchEntitlement(token: string, fetchFn: FetchFn = fetch) {
  return call<{ entitlement: Entitlement }>(fetchFn, 'GET', '/me/entitlement', undefined, token)
}

/** 随账号同步的精选偏好（与服务端 server/src/logic.ts 的 CuratedPrefs 对应） */
export interface CuratedPrefs {
  curatedLevel: string | null
  curatedTags: string[]
  /** 本地修改时间（ms），多端合并取新 */
  updatedAt: number
}

/** 拉取偏好（未同步过返回 null） */
export function getPrefs(token: string, fetchFn: FetchFn = fetch) {
  return call<{ prefs: CuratedPrefs | null }>(fetchFn, 'GET', '/me/prefs', undefined, token)
}

/** 上传偏好（服务端强制付费档；乱序旧值不会覆盖新值） */
export function putPrefs(token: string, prefs: CuratedPrefs, fetchFn: FetchFn = fetch) {
  return call<{ prefs: CuratedPrefs }>(fetchFn, 'PUT', '/me/prefs', prefs, token)
}

/** C1：提交自定义频道（pro 起，审核通过后进管线，随下次内容更新生效） */
export function submitChannel(token: string, handle: string, fetchFn: FetchFn = fetch) {
  return call<{ ok: true; status: 'pending' | 'approved' }>(
    fetchFn,
    'POST',
    '/channels/submit',
    { handle },
    token
  )
}

/** C2：pro+ 精选字幕下发（D4-C 路线的客户端半闸；失败抛错，调用方应回退自抓） */
export async function fetchProCues(
  token: string,
  videoId: string,
  fetchFn: FetchFn = fetch
): Promise<{ start: number; dur: number; text: string }[]> {
  const r = await call<unknown>(fetchFn, 'GET', `/cues/${videoId}`, undefined, token)
  return r as { start: number; dur: number; text: string }[]
}

/** 公告文案（「我的」页底部胶囊块，公开读；空串 = 隐藏）。管理页 /admin 可编辑 */
export function fetchAnnounce(fetchFn: FetchFn = fetch) {
  return call<{ text: string }>(fetchFn, 'GET', '/announce')
}

/**
 * 敏感内容过滤的全局开关（admin 控制，客户端无感）。公开读。
 * 调用方注意：拉取失败/超时应按 on=true 处理（fail closed，合规优先）。
 */
export function fetchFilterSensitive(fetchFn: FetchFn = fetch) {
  return call<{ on: boolean }>(fetchFn, 'GET', '/config/filter-sensitive')
}
