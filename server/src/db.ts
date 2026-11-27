import type { D1Database, KVNamespace } from '@cloudflare/workers-types'
import type { CardRecord, Plan, UserRecord } from './logic'

interface UserRow {
  email: string
  plan: Plan
  expires_at: number | null
  filter_sensitive: number | null
  created_at: number
  updated_at: number
}

interface CardRow {
  code: string
  plan: Exclude<Plan, 'free'>
  days: number
  used_by: string | null
  used_at: number | null
  revoked_at: number | null
  legacy_pending: number
  legacy_applied_plan: Exclude<Plan, 'free'> | null
  legacy_applied_expires_at: number | null
}

const CARD_COLUMNS = 'code, plan, days, used_by, used_at, revoked_at, legacy_pending, legacy_applied_plan, legacy_applied_expires_at'

interface AuthCodeRow {
  attempts: number
  used: number
  expires_at: number
}

function rowToUser(row: UserRow): UserRecord {
  const user: UserRecord = {
    email: row.email,
    plan: row.plan,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
  if (row.filter_sensitive !== null && row.filter_sensitive !== undefined) {
    user.filterSensitive = row.filter_sensitive === 1
  }
  return user
}

function rowToCard(row: CardRow): CardRecord {
  return {
    code: row.code,
    plan: row.plan,
    days: row.days,
    ...(row.used_by ? { usedBy: row.used_by } : {}),
    ...(row.used_at !== null && row.used_at !== undefined ? { usedAt: row.used_at } : {}),
    ...(row.revoked_at !== null && row.revoked_at !== undefined ? { revokedAt: row.revoked_at } : {}),
    ...(row.legacy_pending ? { pending: true } : {}),
    ...(row.legacy_applied_plan ? { appliedPlan: row.legacy_applied_plan } : {}),
    ...(row.legacy_applied_expires_at !== null && row.legacy_applied_expires_at !== undefined
      ? { appliedExpiresAt: row.legacy_applied_expires_at } : {})
  }
}

function filterToInt(v: boolean | null | undefined): number | null {
  if (v === true) return 1
  if (v === false) return 0
  return null
}

function legacyUserInsert(db: D1Database, email: string, legacy: UserRecord) {
  return db.prepare(
    `INSERT OR IGNORE INTO users (email, plan, expires_at, filter_sensitive, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
  ).bind(email, legacy.plan === 'pro' || legacy.plan === 'pro_plus' ? legacy.plan : 'free',
    legacy.expiresAt ?? null, filterToInt(legacy.filterSensitive),
    legacy.createdAt || Date.now(), legacy.updatedAt || Date.now())
}

function legacyCardInsert(db: D1Database, code: string, legacy: CardRecord) {
  if (!legacy || (legacy.plan !== 'pro' && legacy.plan !== 'pro_plus') ||
    !Number.isInteger(legacy.days) || legacy.days <= 0 || legacy.days > 3650 ||
    (legacy.pending && (!legacy.usedBy || !legacy.usedAt))) {
    throw new Error('invalid legacy card; migration not advanced')
  }
  return db.prepare(
    `INSERT OR IGNORE INTO cards (${CARD_COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
  ).bind(code, legacy.plan, legacy.days, legacy.usedBy ?? null,
    legacy.usedBy ? (legacy.usedAt ?? Date.now()) : (legacy.usedAt ?? null),
    legacy.revokedAt ?? null, legacy.pending ? 1 : 0,
    legacy.appliedPlan ?? null, legacy.appliedExpiresAt ?? null)
}

export type LegacyImportKind = 'users' | 'cards'
export interface LegacyImportProgress {
  complete: boolean
  scanned: number
}

/** One bounded, resumable KV page per request. Inserts never overwrite authoritative D1 rows. */
export async function importLegacyPage(
  db: D1Database, kv: KVNamespace, kind: LegacyImportKind
): Promise<LegacyImportProgress> {
  await db.prepare('INSERT OR IGNORE INTO legacy_import_progress (kind) VALUES (?1)').bind(kind).run()
  const progress = await db.prepare('SELECT cursor, complete, scanned FROM legacy_import_progress WHERE kind = ?1')
    .bind(kind).first<{ cursor: string; complete: number; scanned: number }>()
  if (!progress) throw new Error('missing legacy migration checkpoint')
  if (progress.complete) return { complete: true, scanned: progress.scanned }
  const prefix = kind === 'users' ? 'user:' : 'card:'
  const page = await kv.list({ prefix, limit: 20, ...(progress.cursor ? { cursor: progress.cursor } : {}) })
  const records = await Promise.all(page.keys.map(async ({ name }) => ({
    name, value: await kv.get(name, 'json') as UserRecord | CardRecord | null
  })))
  const inserts = records.filter((record) => record.value !== null).map(({ name, value }) =>
    kind === 'users' ? legacyUserInsert(db, name.slice(prefix.length), value as UserRecord)
      : legacyCardInsert(db, name.slice(prefix.length), value as CardRecord))
  const cursor = page.list_complete ? '' : page.cursor
  if (!page.list_complete && (!cursor || cursor === progress.cursor)) throw new Error('legacy migration cursor did not advance')
  // A repeated/concurrent page can be inserted safely. Only the current cursor advances its count.
  await db.batch([...inserts, db.prepare(
    `UPDATE legacy_import_progress SET cursor = ?2, complete = ?3, scanned = scanned + ?4
     WHERE kind = ?1 AND cursor = ?5 AND complete = 0`
  ).bind(kind, cursor, page.list_complete ? 1 : 0, page.keys.length, progress.cursor)])
  const latest = await db.prepare('SELECT complete, scanned FROM legacy_import_progress WHERE kind = ?1')
    .bind(kind).first<{ complete: number; scanned: number }>()
  if (!latest) throw new Error('missing legacy migration checkpoint')
  return { complete: latest.complete === 1, scanned: latest.scanned }
}

/**
 * 读取用户记录（D1 为唯一权威源）。
 * 若 D1 尚未存在该用户，尝试从旧 KV 做一次只读惰性回填（绝不回写 KV，避免双真源）。
 */
export async function getUserRecord(
  db: D1Database,
  kv: KVNamespace | undefined,
  email: string
): Promise<UserRecord | null> {
  const row = await db
    .prepare('SELECT email, plan, expires_at, filter_sensitive, created_at, updated_at FROM users WHERE email = ?1')
    .bind(email)
    .first<UserRow>()
  if (row) return rowToUser(row)

  if (!kv) return null
  const legacy = (await kv.get(`user:${email}`, 'json')) as UserRecord | null
  if (!legacy) return null

  await legacyUserInsert(db, email, legacy).run()

  const migrated = await db
    .prepare('SELECT email, plan, expires_at, filter_sensitive, created_at, updated_at FROM users WHERE email = ?1')
    .bind(email)
    .first<UserRow>()
  return migrated ? rowToUser(migrated) : null
}

/** 登录时确保用户存在（已存在则保留原记录，不存在则原子创建 free 用户） */
export async function ensureUserRecord(
  db: D1Database,
  kv: KVNamespace | undefined,
  email: string,
  now = Date.now()
): Promise<UserRecord> {
  const existing = await getUserRecord(db, kv, email)
  if (existing) return existing
  await db
    .prepare(
      `INSERT OR IGNORE INTO users (email, plan, expires_at, filter_sensitive, created_at, updated_at)
       VALUES (?1, 'free', NULL, NULL, ?2, ?2)`
    )
    .bind(email, now)
    .run()
  const created = await db
    .prepare('SELECT email, plan, expires_at, filter_sensitive, created_at, updated_at FROM users WHERE email = ?1')
    .bind(email)
    .first<UserRow>()
  if (!created) throw new Error('failed to create user record')
  return rowToUser(created)
}

export async function listUserRecords(db: D1Database, limit: number): Promise<UserRecord[]> {
  const result = await db
    .prepare(
      `SELECT email, plan, expires_at, filter_sensitive, created_at, updated_at
       FROM users
       ORDER BY COALESCE(expires_at, 0) DESC, created_at DESC
       LIMIT ?1`
    )
    .bind(limit)
    .all<UserRow>()
  return (result.results ?? []).map(rowToUser)
}

/**
 * 仅更新单字段 filter_sensitive，绝不覆盖 plan / expires_at。
 * 返回更新后的完整用户记录；用户不存在返回 null。
 */
export async function setUserFilterAtomic(
  db: D1Database,
  kv: KVNamespace | undefined,
  email: string,
  filterSensitive: boolean | null,
  now = Date.now()
): Promise<UserRecord | null> {
  const existing = await getUserRecord(db, kv, email)
  if (!existing) return null
  await db
    .prepare('UPDATE users SET filter_sensitive = ?2, updated_at = ?3 WHERE email = ?1')
    .bind(email, filterToInt(filterSensitive), now)
    .run()
  const updated = await db
    .prepare('SELECT email, plan, expires_at, filter_sensitive, created_at, updated_at FROM users WHERE email = ?1')
    .bind(email)
    .first<UserRow>()
  return updated ? rowToUser(updated) : null
}

/**
 * 后台手动开通/顺延或吊销权益：在 D1 权威 users 表上单条原子更新，不覆盖 filter_sensitive。
 */
export async function setUserPlanAtomic(
  db: D1Database,
  kv: KVNamespace | undefined,
  email: string,
  plan: Plan,
  days: number,
  now = Date.now()
): Promise<UserRecord | null> {
  const existing = await getUserRecord(db, kv, email)
  if (!existing) return null

  if (plan === 'free') {
    await db
      .prepare("UPDATE users SET plan = 'free', expires_at = NULL, updated_at = ?2 WHERE email = ?1")
      .bind(email, now)
      .run()
  } else {
    await db
      .prepare(
        `UPDATE users
         SET
           plan = CASE
             WHEN plan != 'free' AND expires_at IS NOT NULL AND expires_at > ?2 THEN
               CASE WHEN plan = 'pro_plus' OR ?3 = 'pro_plus' THEN 'pro_plus' ELSE 'pro' END
             ELSE ?3
           END,
           expires_at = (
             CASE WHEN expires_at IS NOT NULL AND expires_at > ?2 THEN expires_at ELSE ?2 END
           ) + (?4 * 86400000),
           updated_at = ?2
         WHERE email = ?1`
      )
      .bind(email, now, plan, days)
      .run()
  }

  const updated = await db
    .prepare('SELECT email, plan, expires_at, filter_sensitive, created_at, updated_at FROM users WHERE email = ?1')
    .bind(email)
    .first<UserRow>()
  return updated ? rowToUser(updated) : null
}

/** 读取卡密（D1 为唯一权威源，未命中时从旧 KV 惰性只读导入并保留原持有人） */
export async function getCardRecord(
  db: D1Database,
  kv: KVNamespace | undefined,
  code: string
): Promise<CardRecord | null> {
  const row = await db
    .prepare(`SELECT ${CARD_COLUMNS} FROM cards WHERE code = ?1`)
    .bind(code)
    .first<CardRow>()
  if (row) return rowToCard(row)

  if (!kv) return null
  const legacy = (await kv.get(`card:${code}`, 'json')) as CardRecord | null
  if (!legacy) return null

  await legacyCardInsert(db, code, legacy).run()

  const migrated = await db
    .prepare(`SELECT ${CARD_COLUMNS} FROM cards WHERE code = ?1`)
    .bind(code)
    .first<CardRow>()
  return migrated ? rowToCard(migrated) : null
}

export async function createCardsBatch(db: D1Database, cards: CardRecord[]): Promise<void> {
  if (cards.length === 0) return
  const stmts = cards.map((card) =>
    db
      .prepare('INSERT INTO cards (code, plan, days, used_by, used_at) VALUES (?1, ?2, ?3, NULL, NULL)')
      .bind(card.code, card.plan, card.days)
  )
  await db.batch(stmts)
}

export async function listCardRecords(db: D1Database, limit: number): Promise<CardRecord[]> {
  const result = await db
    .prepare(
      `SELECT ${CARD_COLUMNS}
       FROM cards
       WHERE revoked_at IS NULL
       ORDER BY legacy_pending DESC, COALESCE(used_at, 0) DESC, code ASC
       LIMIT ?1`
    )
    .bind(limit)
    .all<CardRow>()
  return (result.results ?? []).map(rowToCard)
}

export type RevokeCardOutcome =
  | { ok: true }
  | { ok: false; status: 404 | 409; error: string }

export async function revokeCardAtomic(
  db: D1Database,
  kv: KVNamespace | undefined,
  code: string,
  now = Date.now()
): Promise<RevokeCardOutcome> {
  const card = await getCardRecord(db, kv, code)
  if (!card) return { ok: false, status: 404, error: 'not found' }
  if (card.revokedAt !== undefined) return { ok: true }
  const res = await db
    .prepare('UPDATE cards SET revoked_at = ?2 WHERE code = ?1 AND used_by IS NULL AND used_at IS NULL AND revoked_at IS NULL')
    .bind(code, now)
    .run()
  if ((res.meta?.changes ?? 0) === 0) {
    if ((await getCardRecord(db, kv, code))?.revokedAt !== undefined) return { ok: true }
    return { ok: false, status: 409, error: 'card already used, keep for record' }
  }
  return { ok: true }
}

/** 写入登录验证码（私有 D1 表，覆盖同一邮箱的旧验证码并重置计数与使用状态） */
export async function storeAuthCode(
  db: D1Database,
  email: string,
  code: string,
  expiresAt: number
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO auth_codes (email, code, attempts, used, expires_at)
       VALUES (?1, ?2, 0, 0, ?3)
       ON CONFLICT(email) DO UPDATE SET
         code = excluded.code,
         attempts = 0,
         used = 0,
         expires_at = excluded.expires_at`
    )
    .bind(email, code, expiresAt)
    .run()
}

export type VerifyCodeOutcome =
  | { ok: true }
  | { ok: false; status: 401 | 429; error: string }

/**
 * 原子验证码校验（私有 D1 单条条件 UPDATE，无并发绕过，也不执行无条件 DELETE 防误删新码）：
 * 1. 先尝试单条原子 UPDATE 将正确且未超限未过期的验证码标记为 used = 1（仅 1 个并发请求可胜出）。
 * 2. 若未命中，再单条原子递增错误次数（attempts = attempts + 1 RETURNING attempts），并发严格串行。
 */
export async function verifyAuthCodeAtomic(
  db: D1Database,
  email: string,
  code: string,
  maxAttempts: number,
  now = Date.now()
): Promise<VerifyCodeOutcome> {
  const consumed = await db
    .prepare(
      `UPDATE auth_codes
       SET used = 1
       WHERE email = ?1
         AND code = ?2
         AND used = 0
         AND attempts < ?3
         AND expires_at > ?4`
    )
    .bind(email, code, maxAttempts, now)
    .run()

  if ((consumed.meta?.changes ?? 0) === 1) {
    return { ok: true }
  }

  const bumped = await db
    .prepare(
      `UPDATE auth_codes
       SET attempts = attempts + 1
       WHERE email = ?1
         AND code != ?2
         AND used = 0
         AND attempts < ?3
         AND expires_at > ?4
       RETURNING attempts`
    )
    .bind(email, code, maxAttempts, now)
    .first<{ attempts: number }>()

  if (bumped) {
    if (bumped.attempts >= maxAttempts) {
      return { ok: false, status: 429, error: 'too many attempts, request a new code' }
    }
    return { ok: false, status: 401, error: 'wrong or expired code' }
  }

  // 未能更新任何行：检查是否已因输错达上限被锁定
  const state = await db
    .prepare('SELECT attempts, used, expires_at FROM auth_codes WHERE email = ?1')
    .bind(email)
    .first<AuthCodeRow>()
  if (state && state.used === 0 && state.expires_at > now && state.attempts >= maxAttempts) {
    return { ok: false, status: 429, error: 'too many attempts, request a new code' }
  }
  return { ok: false, status: 401, error: 'wrong or expired code' }
}

export type RedeemOutcome =
  | { ok: true; user: UserRecord; alreadyRedeemed: boolean }
  | { ok: false; status: 404 | 409; error: string }

/** Conditional receipt, card state and optional credit always commit together. */
async function settleCard(
  db: D1Database, card: CardRecord, email: string, now: number,
  reviewAction?: 'credit' | 'confirm'
): Promise<boolean> {
  const eligibility = reviewAction
    ? 'legacy_pending = 1 AND used_by = ?2'
    : 'used_by IS NULL AND used_at IS NULL AND legacy_pending = 0'
  const txId = crypto.randomUUID()
  const statements = [
    db.prepare(
      `INSERT INTO card_redemptions (code, email, plan, days, applied_at, tx_id)
       SELECT code, ?2, plan, days, ?3, ?4 FROM cards
       WHERE code = ?1 AND revoked_at IS NULL AND (${eligibility})
         AND NOT EXISTS (SELECT 1 FROM card_redemptions WHERE code = ?1)`
    ).bind(card.code, email, now, txId),
    db.prepare(
      `UPDATE cards SET used_by = ?2, used_at = COALESCE(used_at, ?3), legacy_pending = 0
       WHERE code = ?1 AND EXISTS (
         SELECT 1 FROM card_redemptions WHERE code = ?1 AND tx_id = ?4
       )`
    ).bind(card.code, email, now, txId)
  ]
  if (reviewAction !== 'confirm') {
    statements.push(db.prepare(
      `UPDATE users SET
         plan = CASE
           WHEN plan != 'free' AND expires_at IS NOT NULL AND expires_at > ?3 THEN
             CASE WHEN plan = 'pro_plus' OR ?5 = 'pro_plus' THEN 'pro_plus' ELSE 'pro' END
           ELSE ?5 END,
         expires_at = (CASE WHEN expires_at IS NOT NULL AND expires_at > ?3 THEN expires_at ELSE ?3 END)
           + (?6 * 86400000),
         updated_at = ?3
       WHERE email = ?2 AND EXISTS (
         SELECT 1 FROM card_redemptions WHERE code = ?1 AND tx_id = ?4
       )`
    ).bind(card.code, email, now, txId, card.plan, card.days))
  }
  const results = await db.batch(statements)
  return (results[0]?.meta?.changes ?? 0) === 1
}

/** Ambiguous historical claims require an explicit administrator decision; resolution is idempotent. */
export async function resolvePendingCardAtomic(
  db: D1Database, kv: KVNamespace, code: string, action: 'credit' | 'confirm', now = Date.now()
): Promise<RedeemOutcome> {
  const card = await getCardRecord(db, kv, code)
  if (!card) return { ok: false, status: 404, error: 'card not found' }
  if (card.revokedAt !== undefined || !card.usedBy) {
    return { ok: false, status: 409, error: 'card has no pending owner' }
  }
  await ensureUserRecord(db, kv, card.usedBy, now)
  const applied = card.pending ? await settleCard(db, card, card.usedBy, now, action) : false
  const latest = await getCardRecord(db, kv, code)
  if (latest?.pending) return { ok: false, status: 409, error: 'card resolution conflict, retry' }
  const user = await getUserRecord(db, kv, card.usedBy)
  if (!user) throw new Error('missing owner after pending card resolution')
  return { ok: true, user, alreadyRedeemed: !applied }
}

/**
 * 原子事务卡密兑换（D1 batch = SQLite 单个原子事务）：
 * - 在同一事务内：校验未使用并写入带唯一 tx_id 的入账凭证 → 标记 cards.used_by → 在最新 users 行上累加时长。
 * - 任意一步失败整个事务自动回滚（不锁卡、不发权益）；
 * - 多账号并发兑同一张卡严格仅 1 人成功；同账号并发兑多张卡按最新余额依次累加、永不覆盖。
 */
export async function redeemCardAtomic(
  db: D1Database,
  kv: KVNamespace | undefined,
  user: UserRecord,
  code: string,
  now = Date.now()
): Promise<RedeemOutcome> {
  // 先保证卡密与用户已进入 D1 权威源（兼容历史 KV 惰性导入）
  const card = await getCardRecord(db, kv, code)
  if (!card) return { ok: false, status: 404, error: 'card not found' }
  if (card.revokedAt !== undefined) return { ok: false, status: 409, error: 'card revoked' }
  await ensureUserRecord(db, kv, user.email, now)

  const applied = await settleCard(db, card, user.email, now)
  if (applied) {
    const updatedUser = await getUserRecord(db, kv, user.email)
    if (!updatedUser) throw new Error('user record missing after redemption')
    return { ok: true, user: updatedUser, alreadyRedeemed: false }
  }

  // 本次事务未占到卡密：查询真实持有人决定 409 或同用户幂等返回
  const latestCard = await getCardRecord(db, kv, code)
  if (!latestCard) return { ok: false, status: 404, error: 'card not found' }
  if (latestCard.revokedAt !== undefined) return { ok: false, status: 409, error: 'card revoked' }
  if (latestCard.usedBy === user.email) {
    if (latestCard.pending) {
      return { ok: false, status: 409, error: '此卡的历史入账状态需要核对，请联系管理员处理' }
    }
    const latestUser = (await getUserRecord(db, kv, user.email)) ?? user
    return { ok: true, user: latestUser, alreadyRedeemed: true }
  }
  return { ok: false, status: 409, error: 'card already used' }
}
