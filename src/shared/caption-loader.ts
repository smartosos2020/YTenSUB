import type { Cue } from './captions'

/** All video entry points use the same cache → Worker → live extraction order. */
export async function loadAvailableCaptions<T extends { en: Cue[] }>(sources: {
  readCache: () => Promise<T | null>
  readRemote: () => Promise<T | null>
  isCurrent: () => boolean
}): Promise<T | null> {
  const cached = await sources.readCache().catch(() => null)
  if (!sources.isCurrent()) return null
  if (cached?.en?.length) return cached
  const remote = await sources.readRemote().catch(() => null)
  if (!sources.isCurrent()) return null
  return remote?.en?.length ? remote : null
}
