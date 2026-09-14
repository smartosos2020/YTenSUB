/**
 * 账号/权益 API 客户端：与桌面端 src/shared/auth-api.ts 同源（同步拷贝，后续抽公共包）。
 * 上半部分是契约拷贝（含偏好同步 getPrefs/putPrefs）；
 * 下半部分是手机端新增：AsyncStorage 会话/偏好持久化 + 启动预热缓存。
 * 权益本地缓存与离线宽限判定在同源拷贝 entitlement.ts。
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { cacheEntitlement, saveEntitlementCache } from './entitlement'

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

/** 生产 API 地址。本地联调时临时改为 http://127.0.0.1:8787（需 adb reverse），别提交本地地址 */
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

/** 拉取当前权益（启动时后台调用一次） */
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

/* ---------- 以下为手机端新增 ---------- */

const SESSION_KEY = 'ytensub:auth-v1'

/** 读取本地会话；无或数据损坏返回 null */
export async function loadSession(): Promise<AuthSession | null> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as AuthSession
    return typeof s.email === 'string' && typeof s.token === 'string' ? s : null
  } catch {
    return null
  }
}

/** 保存/清除本地会话（传 null = 登出清除） */
export async function saveSession(s: AuthSession | null): Promise<void> {
  try {
    if (s) await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(s))
    else await AsyncStorage.removeItem(SESSION_KEY)
  } catch {
    /* 持久化失败不阻塞界面 */
  }
}

/** 内存缓存：启动预热 + 账号页/精选页共用，避免反复读 AsyncStorage/网络 */
export const authCache: { session: AuthSession | null; entitlement: Entitlement | null } = {
  session: null,
  entitlement: null
}

const PREFS_KEY = 'ytensub:prefs-v1'

/** 读取本地偏好缓存；无或数据损坏返回 null */
export async function loadPrefsCache(): Promise<CuratedPrefs | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as CuratedPrefs
    return Array.isArray(p.curatedTags) && typeof p.updatedAt === 'number' ? p : null
  } catch {
    return null
  }
}

/** 保存/清除本地偏好缓存（传 null = 登出清除） */
export async function savePrefsCache(p: CuratedPrefs | null): Promise<void> {
  try {
    if (p) await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(p))
    else await AsyncStorage.removeItem(PREFS_KEY)
  } catch {
    /* 持久化失败不阻塞界面 */
  }
}

/** 从服务器拉偏好并覆盖本地（服务器为准，MVP 简化策略；服务端未存过则不动本地）。失败静默 */
export async function pullPrefs(token: string): Promise<void> {
  try {
    const r = await getPrefs(token)
    if (r.prefs) await savePrefsCache(r.prefs)
  } catch {
    /* 离线时沿用本地偏好 */
  }
}

/** App 启动调用一次：读本地会话，有会话则后台拉权益（成功写缓存）+ 拉偏好；失败静默 */
export async function primeAuth(): Promise<void> {
  authCache.session = await loadSession()
  if (!authCache.session) return
  try {
    const r = await fetchEntitlement(authCache.session.token)
    authCache.entitlement = r.entitlement
    await saveEntitlementCache(cacheEntitlement(r.entitlement, Date.now()))
  } catch {
    /* 网络不可用时按本地缓存 + 宽限期判定档位（entitlement.ts） */
  }
  await pullPrefs(authCache.session.token)
}
