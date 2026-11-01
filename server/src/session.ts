import type { KVNamespace } from '@cloudflare/workers-types'

export const TOKEN_TTL_S = 30 * 86_400
export const TOKEN_RENEW_WINDOW_MS = 7 * 86_400_000

interface TokenMetadata {
  expiresAt: number
}

/** Keep the email value unchanged so older Workers can still read these sessions. */
export async function writeSession(
  kv: KVNamespace, token: string, email: string, now = Date.now()
): Promise<void> {
  const expiresAt = now + TOKEN_TTL_S * 1000
  await kv.put(`token:${token}`, email, {
    expiration: Math.ceil(expiresAt / 1000),
    metadata: { expiresAt }
  })
}

/** Renew only in the last seven days; legacy sessions acquire metadata on first use. */
export async function readSession(
  kv: KVNamespace, token: string, now = Date.now()
): Promise<string | null> {
  const { value: email, metadata } = await kv.getWithMetadata<TokenMetadata>(`token:${token}`)
  if (!email) return null
  const expiresAt = metadata?.expiresAt
  if (typeof expiresAt === 'number' && Number.isFinite(expiresAt)) {
    if (expiresAt <= now) return null
    if (expiresAt - now > TOKEN_RENEW_WINDOW_MS) return email
  }
  await writeSession(kv, token, email, now)
  return email
}
