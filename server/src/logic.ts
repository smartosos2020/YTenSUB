/**
 * YTenSUB 账号/权益服务端 — 纯逻辑模块（零依赖，不引用 Workers 类型）。
 * 被 src/index.ts（Worker 入口）与桌面端 tests/server-logic.test.ts 共用。
 */

export type Plan = 'free' | 'pro' | 'pro_plus'

export interface UserRecord {
  email: string
  plan: Plan
  /** 权益到期时间（ms 时间戳）；null = 从未付费 */
  expiresAt: number | null
  /** 敏感内容过滤的用户级覆盖：true=强制开，false=强制关，null/缺省=跟随全局 */
  filterSensitive?: boolean | null
  createdAt: number
  updatedAt: number
}

export interface CardRecord {
  code: string
  plan: Exclude<Plan, 'free'>
  /** 开通天数 */
  days: number
  usedBy?: string
  usedAt?: number
}

export interface Entitlement {
  plan: Plan
  expiresAt: number | null
  /** 离线宽限天数（服务端可调，D5） */
  graceDays: number
  /** 该用户的敏感内容过滤生效值（已解析：用户级覆盖 > 全局开关） */
  filterSensitive: boolean
}

const PLAN_RANK: Record<Plan, number> = { free: 0, pro: 1, pro_plus: 2 }

/** 当前生效档位：过期即回落 free（不改动存储里的原记录） */
export function effectivePlan(user: UserRecord, now: number): Plan {
  if (user.plan !== 'free' && user.expiresAt && user.expiresAt > now) return user.plan
  return 'free'
}

export function toEntitlement(
  user: UserRecord,
  now: number,
  graceDays: number,
  globalFilterSensitive = true
): Entitlement {
  return {
    plan: effectivePlan(user, now),
    expiresAt: user.expiresAt,
    graceDays,
    filterSensitive: resolveFilterSensitive(user, globalFilterSensitive)
  }
}

/** 用户级覆盖优先，未设置跟随全局 */
export function resolveFilterSensitive(user: UserRecord, globalOn: boolean): boolean {
  return user.filterSensitive ?? globalOn
}

/**
 * 卡密兑换：从 max(now, 现有到期) 顺延天数。
 * 档位规则：当前生效档位更高时保留高档位（pro+ 用户兑 pro 卡只延时间不降级）；
 * 当前为 free（含已过期）则采用卡面档位。
 */
export function applyCard(user: UserRecord, card: CardRecord, now: number): UserRecord {
  const base = user.expiresAt && user.expiresAt > now ? user.expiresAt : now
  const active = effectivePlan(user, now)
  const plan = PLAN_RANK[active] >= PLAN_RANK[card.plan] ? active : card.plan
  return {
    ...user,
    plan,
    expiresAt: base + card.days * 86_400_000,
    updatedAt: now
  }
}

/** 发信服务商：Resend 优先（需自有域名），SendGrid 兜底（单发件人验证即可，无需域名） */export function chooseMailProvider(env: {
  RESEND_API_KEY?: string
  SENDGRID_API_KEY?: string
}): 'resend' | 'sendgrid' | null {
  if (env.RESEND_API_KEY) return 'resend'
  if (env.SENDGRID_API_KEY) return 'sendgrid'
  return null
}

/** 去除易混淆字符（0/O/1/I/L）的卡密字符集 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/** 生成 YTS-XXXX-XXXX-XXXX 格式卡密；rand 返回 [0,1)，可注入以便测试 */
export function makeCardCode(rand: () => number): string {
  const pick = () => CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)]
  const group = () => pick() + pick() + pick() + pick()
  return `YTS-${group()}-${group()}-${group()}`
}

export function normalizeCardCode(input: string): string {
  return input.trim().toUpperCase()
}

export function isValidCardCode(code: string): boolean {
  return /^YTS-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code)
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254
}

/** 与桌面端 src/shared/types.ts 的 CEFR_LEVELS 同步（本模块零依赖，故复制常量） */
const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const

/** 随账号同步的精选偏好（B4；对应桌面 Settings.curatedLevel/curatedTags） */
export interface CuratedPrefs {
  curatedLevel: string | null
  curatedTags: string[]
  /** 客户端本地修改时间（ms），多端合并取新 */
  updatedAt: number
}

/**
 * 清洗客户端上传的偏好：非法输入返回 null（400）；
 * level 必须在 CEFR 表内或 null；tags 去重、限长限量（防异常大 payload 刷存储）。
 */
export function sanitizePrefs(input: unknown, now: number): CuratedPrefs | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  const level =
    raw.curatedLevel === null || raw.curatedLevel === undefined
      ? null
      : CEFR_LEVELS.includes(raw.curatedLevel as (typeof CEFR_LEVELS)[number])
        ? (raw.curatedLevel as string)
        : undefined
  if (level === undefined) return null
  if (!Array.isArray(raw.curatedTags)) return null
  const tags = [
    ...new Set(
      raw.curatedTags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0 && t.length <= 24)
    )
  ].slice(0, 16)
  const updatedAt =
    typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) && raw.updatedAt > 0
      ? raw.updatedAt
      : now
  return { curatedLevel: level, curatedTags: tags, updatedAt }
}

/** 多端合并：updatedAt 新者胜；相等时以服务端已有为准（稳定） */
export function mergePrefs(local: CuratedPrefs | null, remote: CuratedPrefs | null): CuratedPrefs | null {
  if (!local) return remote
  if (!remote) return local
  return local.updatedAt > remote.updatedAt ? local : remote
}

// ---------- C1 用户自定义频道订阅 ----------

export type ChannelStatus = 'pending' | 'approved' | 'rejected'

export interface UserChannel {
  /** 规范化后的频道标识：@handle 或 UC 开头 channelId */
  handle: string
  submittedBy: string
  submittedAt: number
  status: ChannelStatus
}

/**
 * 规范化频道输入：支持 @handle、裸 handle、youtube.com/@handle 链接、UC 开头 channelId。
 * 非法输入返回 null。
 */
export function normalizeChannelHandle(input: string): string | null {
  let s = input.trim()
  if (!s) return null
  // 完整/半截 URL 形式取 @handle 段
  const urlMatch = /(?:youtube\.com\/)?(?:@)([\w.-]+)/i.exec(s)
  if (s.includes('youtube.com') || s.startsWith('@')) {
    if (!urlMatch) return null
    s = '@' + urlMatch[1]
  }
  if (/^UC[\w-]{22}$/.test(s)) return s
  if (/^@[\w.-]{2,100}$/.test(s)) return s
  if (/^[\w.-]{2,100}$/.test(s)) return '@' + s
  return null
}

/** YouTube videoId 校验（11 位） */
export function isValidVideoId(id: string): boolean {
  return /^[\w-]{11}$/.test(id)
}

// ---------- 公告文案（「我的」页底部胶囊块；管理页可编辑） ----------

/** 公告文案清洗：去首尾空白，限 500 字；空串返回 null（客户端应隐藏胶囊块） */
export function sanitizeAnnounce(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const s = input.trim()
  return s ? s.slice(0, 500) : null
}

// ---------- 会员管理（admin 手动调整） ----------

/** 手动开通/顺延：等价于兑一张自定义卡（plan 不能为 free，吊销用 revokePlan） */
export function grantPlan(user: UserRecord, plan: Exclude<Plan, 'free'>, days: number, now: number): UserRecord {
  return applyCard(user, { code: '(admin)', plan, days }, now)
}

/** 吊销权益：回落 free、清到期（保留用户记录与过滤覆盖等其他字段） */
export function revokePlan(user: UserRecord, now: number): UserRecord {
  return { ...user, plan: 'free', expiresAt: null, updatedAt: now }
}
