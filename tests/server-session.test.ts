import { describe, expect, it, vi } from 'vitest'
import { readSession, writeSession, TOKEN_TTL_S, TOKEN_RENEW_WINDOW_MS } from '../server/src/session'

const NOW = 1_790_000_000_000
const DAY = 86_400_000
const EMAIL = 'a@b.co'

function store(value: string | null, metadata: { expiresAt: number } | null) {
  const put = vi.fn(async (_key: string, next: string, options: { metadata: { expiresAt: number } }) => {
    value = next
    metadata = options.metadata
  })
  const kv = { getWithMetadata: vi.fn(async () => ({ value, metadata })), put }
  return { kv: kv as unknown as Parameters<typeof readSession>[0], put }
}

describe('session renewal', () => {
  it('creates a 30-day session with matching expiration metadata', async () => {
    const { kv, put } = store(null, null)
    await writeSession(kv, 'token', EMAIL, NOW)
    expect(put).toHaveBeenCalledWith('token:token', EMAIL, {
      expiration: Math.ceil((NOW + TOKEN_TTL_S * 1000) / 1000),
      metadata: { expiresAt: NOW + TOKEN_TTL_S * 1000 }
    })
  })

  it('does not write on repeated requests outside the renewal window', async () => {
    const { kv, put } = store(EMAIL, { expiresAt: NOW + 8 * DAY })
    expect(await readSession(kv, 'token', NOW)).toBe(EMAIL)
    expect(await readSession(kv, 'token', NOW + 1000)).toBe(EMAIL)
    expect(put).not.toHaveBeenCalled()
  })

  it('renews at the seven-day boundary and subsequent reads do not write', async () => {
    const { kv, put } = store(EMAIL, { expiresAt: NOW + TOKEN_RENEW_WINDOW_MS })
    expect(await readSession(kv, 'token', NOW)).toBe(EMAIL)
    expect(await readSession(kv, 'token', NOW + 1000)).toBe(EMAIL)
    expect(put).toHaveBeenCalledTimes(1)
  })

  it('migrates legacy email-only sessions on their first use', async () => {
    const { kv, put } = store(EMAIL, null)
    expect(await readSession(kv, 'legacy', NOW)).toBe(EMAIL)
    expect(await readSession(kv, 'legacy', NOW + 1000)).toBe(EMAIL)
    expect(put).toHaveBeenCalledTimes(1)
  })

  it('does not revive missing or expired sessions', async () => {
    for (const entry of [store(null, null), store(EMAIL, { expiresAt: NOW })]) {
      expect(await readSession(entry.kv, 'token', NOW)).toBeNull()
      expect(entry.put).not.toHaveBeenCalled()
    }
  })
})
