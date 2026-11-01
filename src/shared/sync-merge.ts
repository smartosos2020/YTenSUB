/** Pure merge rules shared by the desktop sync server and Android client. */
export interface SyncVocabItem {
  id: string
  text: string
  addedAt: number
  reviewLevel?: number
  reviewDue?: number
}

export interface SyncShadowingItem {
  videoId: string
  generatedAt: number
}

/** Deduplicate by normalized word, keeping newer fields and the highest review level. */
export function mergeVocab<T extends SyncVocabItem>(local: T[], incoming: T[]): T[] {
  const byText = new Map<string, T>()
  for (const value of [...local, ...incoming]) {
    const key = value.text.trim().toLowerCase()
    const current = byText.get(key)
    if (!current) {
      byText.set(key, value)
      continue
    }
    const newer = value.addedAt > current.addedAt ? value : current
    const older = newer === value ? current : value
    const level = Math.max(newer.reviewLevel ?? 0, older.reviewLevel ?? 0)
    byText.set(key, {
      ...newer,
      reviewLevel: level,
      reviewDue: level === (newer.reviewLevel ?? 0) ? newer.reviewDue : older.reviewDue
    })
  }
  return [...byText.values()]
}

/** Deduplicate scripts by video ID, keeping the most recently generated script. */
export function mergeShadowing<T extends SyncShadowingItem>(local: T[], incoming: T[]): T[] {
  const byId = new Map<string, T>()
  for (const script of [...local, ...incoming]) {
    const current = byId.get(script.videoId)
    if (!current || script.generatedAt > current.generatedAt) byId.set(script.videoId, script)
  }
  return [...byId.values()]
}
