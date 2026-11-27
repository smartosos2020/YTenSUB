import { describe, expect, it, vi } from 'vitest'
import worker, { type Env } from '../server/src/index'
import type { CardRecord, UserRecord } from '../server/src/logic'
import { createSqliteD1, type TestD1 } from './helpers/d1-sqlite'
import { getCardRecord, importLegacyPage, setUserPlanAtomic } from '../server/src/db'

const BASE = 'https://api.example'
const DAY_MS = 86_400_000

interface MemoryKv {
  kv: Env['YTENSUB_KV']
  data: Map<string, { value: string; metadata?: unknown }>
  putSpy: ReturnType<typeof vi.fn>
}

function createMemoryKv(): MemoryKv {
  const data = new Map<string, { value: string; metadata?: unknown }>()
  const putSpy = vi.fn(async (key: string, value: string, options?: { metadata?: unknown }) => {
    await Promise.resolve()
    data.set(key, { value, metadata: options?.metadata })
  })
  return {
    data,
    putSpy,
    kv: {
      get: vi.fn(async (key: string, type?: string) => {
        await Promise.resolve()
        const entry = data.get(key)
        if (!entry) return null
        return type === 'json' ? JSON.parse(entry.value) : entry.value
      }),
      getWithMetadata: vi.fn(async (key: string) => {
        await Promise.resolve()
        const entry = data.get(key)
        return { value: entry?.value ?? null, metadata: entry?.metadata ?? null }
      }),
      put: putSpy,
      delete: vi.fn(async (key: string) => {
        await Promise.resolve()
        data.delete(key)
      }),
      list: vi.fn(async ({ prefix, limit = 20, cursor = '0' }: { prefix: string; limit?: number; cursor?: string }) => {
        const names = [...data.keys()].filter((key) => key.startsWith(prefix)).sort()
        const offset = Number(cursor)
        const next = Math.min(offset + limit, names.length)
        return {
          keys: names.slice(offset, next).map((name) => ({ name })),
          list_complete: next === names.length,
          cursor: String(next), cacheStatus: null
        }
      })
    } as unknown as Env['YTENSUB_KV']
  }
}

function createSpyR2() {
  const get = vi.fn(async () => null)
  const put = vi.fn(async () => {
    throw new Error('CONTENT_BUCKET must never receive auth/card/user writes')
  })
  const del = vi.fn(async () => undefined)
  return {
    get,
    put,
    del,
    bucket: { get, put, delete: del } as unknown as Env['CONTENT_BUCKET']
  }
}

function makeEnv(d1: TestD1, mem: MemoryKv, r2: ReturnType<typeof createSpyR2>, overrides: Partial<Env> = {}): Env {
  return {
    DB: d1.db,
    YTENSUB_KV: mem.kv,
    CONTENT_BUCKET: r2.bucket,
    ADMIN_TOKEN: 'admin-secret',
    DEV_MODE: 'true',
    ...overrides
  }
}

function req(path: string, init?: RequestInit): Request {
  return new Request(BASE + path, init)
}

function seedSession(mem: MemoryKv, token: string, email: string): void {
  mem.data.set(`token:${token}`, {
    value: email,
    metadata: { expiresAt: Date.now() + 20 * DAY_MS }
  })
}

function seedUser(d1: TestD1, email: string, plan: UserRecord['plan'] = 'free', expiresAt: number | null = null): void {
  d1.sqlite
    .prepare(
      'INSERT INTO users (email, plan, expires_at, filter_sensitive, created_at, updated_at) VALUES (?1, ?2, ?3, NULL, 1, 1)'
    )
    .run(email, plan, expiresAt)
}

function seedCard(d1: TestD1, code: string, plan: 'pro' | 'pro_plus' = 'pro', days = 30): void {
  d1.sqlite
    .prepare('INSERT INTO cards (code, plan, days, used_by, used_at) VALUES (?1, ?2, ?3, NULL, NULL)')
    .run(code, plan, days)
}

describe('Worker private D1 auth code verification', () => {
  it('never writes verification codes to public CONTENT_BUCKET and blocks 10 concurrent wrong attempts', async () => {
    const d1 = createSqliteD1()
    const mem = createMemoryKv()
    const r2 = createSpyR2()
    const env = makeEnv(d1, mem, r2)

    const codeRes = await worker.fetch(
      req('/auth/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'user@example.com' })
      }),
      env
    )
    expect(codeRes.status).toBe(200)
    expect(r2.put).not.toHaveBeenCalled()

    const { devCode } = (await codeRes.json()) as { devCode: string }
    const wrongCode = devCode === '000000' ? '111111' : '000000'

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        worker.fetch(
          req('/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'user@example.com', code: wrongCode })
          }),
          env
        )
      )
    )
    const statuses = results.map((r) => r.status)
    expect(statuses.filter((s) => s === 401)).toHaveLength(4)
    expect(statuses.filter((s) => s === 429)).toHaveLength(6)

    // 锁定后即使用正确验证码也无法登录
    const afterLock = await worker.fetch(
      req('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'user@example.com', code: devCode })
      }),
      env
    )
    expect(afterLock.status).toBe(429)
    expect(r2.put).not.toHaveBeenCalled()
    d1.close()
  })

  it('allows only one concurrent login with the same valid code and never deletes a newly issued code', async () => {
    const d1 = createSqliteD1()
    const mem = createMemoryKv()
    const r2 = createSpyR2()
    const env = makeEnv(d1, mem, r2)

    const res1 = await worker.fetch(
      req('/auth/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'once@example.com' })
      }),
      env
    )
    const { devCode: code1 } = (await res1.json()) as { devCode: string }

    // 并发重放同一个正确验证码：仅允许 1 次成功
    const [a, b] = await Promise.all([
      worker.fetch(
        req('/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'once@example.com', code: code1 })
        }),
        env
      ),
      worker.fetch(
        req('/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'once@example.com', code: code1 })
        }),
        env
      )
    ])
    expect([a.status, b.status].sort()).toEqual([200, 401])

    // 清除发码限流后重新申请新验证码：旧登录只标记 used=1 不删除行，新验证码可正常登录
    mem.data.delete('rl:code:once@example.com')
    const res2 = await worker.fetch(
      req('/auth/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'once@example.com' })
      }),
      env
    )
    const { devCode: code2 } = (await res2.json()) as { devCode: string }

    const login2 = await worker.fetch(
      req('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'once@example.com', code: code2 })
      }),
      env
    )
    expect(login2.status).toBe(200)
    expect(r2.put).not.toHaveBeenCalled()
    d1.close()
  })
})

describe('Worker private D1 atomic card redemption & single source of truth', () => {
  const CARD_A = 'YTS-AAAA-BBBB-CCCC'
  const CARD_B = 'YTS-DDDD-EEEE-FFFF'

  it('prevents two accounts from concurrently redeeming the same card and never touches public R2', async () => {
    const d1 = createSqliteD1()
    const mem = createMemoryKv()
    const r2 = createSpyR2()
    seedSession(mem, 'alice', 'alice@example.com')
    seedSession(mem, 'bob', 'bob@example.com')
    seedUser(d1, 'alice@example.com')
    seedUser(d1, 'bob@example.com')
    seedCard(d1, CARD_A, 'pro', 30)
    const env = makeEnv(d1, mem, r2)

    const [aliceRes, bobRes] = await Promise.all([
      worker.fetch(
        req('/redeem', {
          method: 'POST',
          headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: CARD_A })
        }),
        env
      ),
      worker.fetch(
        req('/redeem', {
          method: 'POST',
          headers: { Authorization: 'Bearer bob', 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: CARD_A })
        }),
        env
      )
    ])

    expect([aliceRes.status, bobRes.status].sort()).toEqual([200, 409])
    const rows = d1.sqlite.prepare("SELECT email FROM users WHERE plan = 'pro'").all()
    expect(rows).toHaveLength(1)
    expect(r2.put).not.toHaveBeenCalled()
    d1.close()
  })

  it('rolls back cleanly on mid-transaction failure and preserves 60 days when interleaved with card B', async () => {
    const d1 = createSqliteD1()
    const mem = createMemoryKv()
    const r2 = createSpyR2()
    seedSession(mem, 'alice', 'alice@example.com')
    seedUser(d1, 'alice@example.com')
    seedCard(d1, CARD_A, 'pro', 30)
    seedCard(d1, CARD_B, 'pro', 30)
    const env = makeEnv(d1, mem, r2, { DEV_MODE: 'false' })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // 1. 模拟卡 A 在事务第 3 步更新 users 时失败 → SQLite 整批回滚（不锁卡、不插凭证、不加时长）
    d1.failBatchOnSql = (_sql, index) => index === 2
    const failA = await worker.fetch(
      req('/redeem', {
        method: 'POST',
        headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: CARD_A })
      }),
      env
    )
    expect(failA.status).toBe(500)
    expect(await failA.json()).toEqual({ error: 'internal' })
    errSpy.mockRestore()
    d1.failBatchOnSql = undefined

    // 2. 兑 30 天卡 B 成功
    const okB = await worker.fetch(
      req('/redeem', {
        method: 'POST',
        headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: CARD_B })
      }),
      env
    )
    expect(okB.status).toBe(200)
    const bodyB = (await okB.json()) as { entitlement: { expiresAt: number } }

    // 3. 重试 30 天卡 A：在 B 的 30 天基础上完整累加到 60 天
    const retryA = await worker.fetch(
      req('/redeem', {
        method: 'POST',
        headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: CARD_A })
      }),
      env
    )
    expect(retryA.status).toBe(200)
    const bodyA = (await retryA.json()) as { entitlement: { expiresAt: number }; alreadyRedeemed?: boolean }
    expect(bodyA.alreadyRedeemed).toBeUndefined()
    expect(bodyA.entitlement.expiresAt - bodyB.entitlement.expiresAt).toBe(30 * DAY_MS)

    // 4. 再次重试卡 A 幂等返回，绝不重复叠加；/me/entitlement 同样直接读 D1 权威源显示 60 天
    const retryA2 = await worker.fetch(
      req('/redeem', {
        method: 'POST',
        headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: CARD_A })
      }),
      env
    )
    expect(retryA2.status).toBe(200)
    const bodyA2 = (await retryA2.json()) as { entitlement: { expiresAt: number }; alreadyRedeemed?: boolean }
    expect(bodyA2.alreadyRedeemed).toBe(true)
    expect(bodyA2.entitlement.expiresAt).toBe(bodyA.entitlement.expiresAt)

    const meRes = await worker.fetch(
      req('/me/entitlement', { headers: { Authorization: 'Bearer alice' } }),
      env
    )
    const me = (await meRes.json()) as { entitlement: { plan: string; expiresAt: number } }
    expect(me.entitlement.plan).toBe('pro')
    expect(me.entitlement.expiresAt).toBe(bodyA.entitlement.expiresAt)
    d1.close()
  })

  it('accumulates 60 days on concurrent card A + B redemptions and never loses days when admin updates filterSensitive', async () => {
    const d1 = createSqliteD1()
    const mem = createMemoryKv()
    const r2 = createSpyR2()
    seedSession(mem, 'alice', 'alice@example.com')
    seedUser(d1, 'alice@example.com')
    seedCard(d1, CARD_A, 'pro', 30)
    seedCard(d1, CARD_B, 'pro', 30)
    const env = makeEnv(d1, mem, r2)
    const start = Date.now()

    // 并发兑卡 A + 后台改过滤设置 + 兑卡 B
    const [resA, resFilter, resB] = await Promise.all([
      worker.fetch(
        req('/redeem', {
          method: 'POST',
          headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: CARD_A })
        }),
        env
      ),
      worker.fetch(
        req('/admin/user/filter', {
          method: 'POST',
          headers: { Authorization: 'Bearer admin-secret', 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'alice@example.com', mode: 'off' })
        }),
        env
      ),
      worker.fetch(
        req('/redeem', {
          method: 'POST',
          headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: CARD_B })
        }),
        env
      )
    ])

    expect(resA.status).toBe(200)
    expect(resFilter.status).toBe(200)
    expect(resB.status).toBe(200)

    const meRes = await worker.fetch(
      req('/me/entitlement', { headers: { Authorization: 'Bearer alice' } }),
      env
    )
    const { entitlement } = (await meRes.json()) as {
      entitlement: { plan: string; expiresAt: number; filterSensitive: boolean }
    }
    expect(entitlement.plan).toBe('pro')
    expect(entitlement.filterSensitive).toBe(false)
    expect(entitlement.expiresAt - start).toBeGreaterThanOrEqual(59.9 * DAY_MS)
    expect(entitlement.expiresAt - start).toBeLessThanOrEqual(60.1 * DAY_MS)
    // D1 为唯一权威源，不会向 KV 回写 user:* 或 card:*
    const kvKeysWritten = mem.putSpy.mock.calls.map(([k]) => String(k))
    expect(kvKeysWritten.some((k) => k.startsWith('user:') || k.startsWith('card:'))).toBe(false)
    d1.close()
  })

  it('preserves original owner when lazily migrating an already-used legacy KV card', async () => {
    const d1 = createSqliteD1()
    const mem = createMemoryKv()
    const r2 = createSpyR2()
    seedSession(mem, 'alice', 'alice@example.com')
    seedSession(mem, 'bob', 'bob@example.com')
    const exp = Date.now() + 30 * DAY_MS
    const legacyAlice: UserRecord = {
      email: 'alice@example.com', plan: 'pro', expiresAt: exp, createdAt: 1, updatedAt: 1
    }
    const legacyCard: CardRecord = {
      code: CARD_A, plan: 'pro', days: 30, usedBy: 'alice@example.com', usedAt: 100
    }
    mem.data.set('user:alice@example.com', { value: JSON.stringify(legacyAlice) })
    mem.data.set(`card:${CARD_A}`, { value: JSON.stringify(legacyCard) })
    seedUser(d1, 'bob@example.com')
    const env = makeEnv(d1, mem, r2)

    // Bob 尝试兑旧 KV 里已属于 Alice 的卡 → 409
    const bobRes = await worker.fetch(
      req('/redeem', {
        method: 'POST',
        headers: { Authorization: 'Bearer bob', 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: CARD_A })
      }),
      env
    )
    expect(bobRes.status).toBe(409)

    // Alice 重试同一张旧卡 → 幂等返回且不重复叠加天数
    const aliceRes = await worker.fetch(
      req('/redeem', {
        method: 'POST',
        headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: CARD_A })
      }),
      env
    )
    expect(aliceRes.status).toBe(200)
    const body = (await aliceRes.json()) as { entitlement: { expiresAt: number }; alreadyRedeemed?: boolean }
    expect(body.alreadyRedeemed).toBe(true)
    expect(body.entitlement.expiresAt).toBe(exp)
    d1.close()
  })
})

describe('Legacy account and card migration', () => {
  const EMAIL = 'alice@example.com'
  const CODE = 'YTS-AAAA-BBBB-CCCC'
  const adminHeaders = { Authorization: 'Bearer admin-secret', 'Content-Type': 'application/json' }

  function setup(pending = false, credited = false) {
    const d1 = createSqliteD1()
    const mem = createMemoryKv()
    const r2 = createSpyR2()
    seedSession(mem, 'alice', EMAIL)
    seedSession(mem, 'bob', 'bob@example.com')
    seedUser(d1, 'bob@example.com')
    const expiresAt = credited ? Date.now() + 30 * DAY_MS : null
    const user: UserRecord = { email: EMAIL, plan: credited ? 'pro' : 'free', expiresAt, createdAt: 1, updatedAt: 1 }
    mem.data.set(`user:${EMAIL}`, { value: JSON.stringify(user) })
    const card: CardRecord = { code: CODE, plan: 'pro', days: 30,
      ...(pending ? { usedBy: EMAIL, usedAt: 100, pending: true, appliedPlan: 'pro' as const,
        appliedExpiresAt: Date.now() + 30 * DAY_MS } : {}) }
    mem.data.set(`card:${CODE}`, { value: JSON.stringify(card) })
    const env = makeEnv(d1, mem, r2)
    const request = (path: string, body?: unknown, token = 'admin-secret') => worker.fetch(req(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...adminHeaders, Authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }), env)
    return { d1, mem, r2, env, request, expiresAt }
  }

  it('keeps revoked legacy cards revoked after retries, listing and repeated migration', async () => {
    const s = setup()
    expect((await s.request('/admin/cards/revoke', { code: CODE })).status).toBe(200)
    expect((await s.request('/admin/cards/revoke', { code: CODE })).status).toBe(200)
    expect(s.mem.data.has(`card:${CODE}`)).toBe(true)
    expect((await getCardRecord(s.d1.db, s.mem.kv, CODE))?.revokedAt).toBeTypeOf('number')
    await importLegacyPage(s.d1.db, s.mem.kv, 'cards')
    expect((await s.request('/redeem', { code: CODE }, 'alice')).status).toBe(409)
    const listed = await (await s.request('/admin/cards')).json() as { cards: CardRecord[] }
    expect(listed.cards).toEqual([])
    expect(s.d1.sqlite.prepare('SELECT COUNT(*) AS n FROM card_redemptions').get()?.n).toBe(0)
    s.d1.close()
  })

  it('retains pending owner and metadata, requires review, and credits exactly once under concurrent admin retries', async () => {
    const s = setup(true)
    expect((await s.request('/redeem', { code: CODE }, 'bob')).status).toBe(409)
    const retry = await s.request('/redeem', { code: CODE }, 'alice')
    expect(retry.status).toBe(409)
    expect((await retry.json() as { error: string }).error).toContain('核对')
    const listed = await (await s.request('/admin/cards')).json() as { cards: CardRecord[] }
    expect(listed.cards[0]).toMatchObject({ pending: true, usedBy: EMAIL, appliedPlan: 'pro' })
    expect(listed.cards[0].appliedExpiresAt).toBeTypeOf('number')
    expect((await s.request('/admin/cards/resolve', { code: CODE, action: 'credit' }, 'alice')).status).toBe(401)
    const before = Date.now()
    const responses = await Promise.all(Array.from({ length: 5 }, () =>
      s.request('/admin/cards/resolve', { code: CODE, action: 'credit' })))
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200, 200])
    const me = await (await s.request('/me/entitlement', undefined, 'alice')).json() as {
      entitlement: { plan: string; expiresAt: number }
    }
    expect(me.entitlement.plan).toBe('pro')
    expect(me.entitlement.expiresAt - before).toBeGreaterThanOrEqual(30 * DAY_MS)
    expect(me.entitlement.expiresAt - before).toBeLessThan(30 * DAY_MS + 1000)
    expect(s.d1.sqlite.prepare('SELECT COUNT(*) AS n FROM card_redemptions').get()?.n).toBe(1)
    expect((await s.request('/redeem', { code: CODE }, 'alice')).status).toBe(200)
    expect((await getCardRecord(s.d1.db, s.mem.kv, CODE))?.pending).toBeUndefined()
    expect(s.r2.put).not.toHaveBeenCalled()
    s.d1.close()
  })

  it('confirms an already credited pending card without granting additional days, including later credit retries', async () => {
    const s = setup(true, true)
    expect((await s.request('/redeem', { code: CODE }, 'alice')).status).toBe(409)
    expect((await s.request('/admin/cards/resolve', { code: CODE, action: 'confirm' })).status).toBe(200)
    expect((await s.request('/admin/cards/resolve', { code: CODE, action: 'credit' })).status).toBe(200)
    const row = s.d1.sqlite.prepare('SELECT expires_at FROM users WHERE email = ?1').get(EMAIL)
    expect(row?.expires_at).toBe(s.expiresAt)
    expect(s.d1.sqlite.prepare('SELECT COUNT(*) AS n FROM card_redemptions').get()?.n).toBe(1)
    s.d1.close()
  })

  it('rolls back a failed pending credit and allows a safe retry', async () => {
    const s = setup(true)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    s.d1.failBatchOnSql = (_sql, index) => index === 2
    try {
      expect((await s.request('/admin/cards/resolve', { code: CODE, action: 'credit' })).status).toBe(500)
      expect(s.d1.sqlite.prepare('SELECT legacy_pending FROM cards WHERE code = ?1').get(CODE)?.legacy_pending).toBe(1)
      expect(s.d1.sqlite.prepare('SELECT COUNT(*) AS n FROM card_redemptions').get()?.n).toBe(0)
      s.d1.failBatchOnSql = undefined
      expect((await s.request('/admin/cards/resolve', { code: CODE, action: 'credit' })).status).toBe(200)
    } finally { errorSpy.mockRestore(); s.d1.close() }
  })

  it('imports old members and cards when opening admin lists, without any prior user activity', async () => {
    const s = setup()
    const users = await (await s.request('/admin/users')).json() as { users: { user: UserRecord }[] }
    expect(users.users.map(({ user }) => user.email)).toContain(EMAIL)
    const cards = await (await s.request('/admin/cards')).json() as { cards: CardRecord[] }
    expect(cards.cards.map((card) => card.code)).toContain(CODE)
    expect(s.mem.putSpy).not.toHaveBeenCalled()
    s.d1.close()
  })

  it('resumes paginated imports after interruption and preserves newer D1 data on repeated/concurrent pages', async () => {
    const s = setup()
    for (let i = 0; i < 44; i++) {
      const email = `member-${String(i).padStart(2, '0')}@example.com`
      s.mem.data.set(`user:${email}`, { value: JSON.stringify({ email, plan: 'free', expiresAt: null, createdAt: 1, updatedAt: 1 }) })
    }
    const first = await importLegacyPage(s.d1.db, s.mem.kv, 'users')
    expect(first).toEqual({ complete: false, scanned: 20 })
    await setUserPlanAtomic(s.d1.db, s.mem.kv, EMAIL, 'pro_plus', 90)
    const listMock = vi.mocked(s.mem.kv.list)
    listMock.mockRejectedValueOnce(new Error('simulated list interruption'))
    await expect(importLegacyPage(s.d1.db, s.mem.kv, 'users')).rejects.toThrow('interruption')
    expect(s.d1.sqlite.prepare("SELECT scanned FROM legacy_import_progress WHERE kind = 'users'").get()?.scanned).toBe(20)
    await Promise.all([importLegacyPage(s.d1.db, s.mem.kv, 'users'), importLegacyPage(s.d1.db, s.mem.kv, 'users')])
    expect(await importLegacyPage(s.d1.db, s.mem.kv, 'users')).toEqual({ complete: true, scanned: 45 })
    expect(await importLegacyPage(s.d1.db, s.mem.kv, 'users')).toEqual({ complete: true, scanned: 45 })
    expect(s.d1.sqlite.prepare('SELECT plan FROM users WHERE email = ?1').get(EMAIL)?.plan).toBe('pro_plus')
    expect(s.d1.sqlite.prepare('SELECT COUNT(*) AS n FROM users').get()?.n).toBe(46)
    expect((await s.request('/admin/migrate/legacy', { kind: 'users' }, 'alice')).status).toBe(401)
    expect((await s.request('/admin/migrate/legacy', { kind: 'wrong' })).status).toBe(400)
    expect((await s.request('/admin/migrate/legacy', { kind: 'users' })).status).toBe(200)
    s.d1.close()
  })
})
