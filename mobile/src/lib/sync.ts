import {
  mergeVocab,
  shadowingMerge,
  shadowingList,
  ShadowingScript,
  VocabItem,
  vocabList,
  vocabReplaceAll
} from './storage'

/** 与桌面端 SyncPayload 同构 */
interface SyncPayload {
  version: number
  exportedAt: number
  vocab: VocabItem[]
  shadowing: ShadowingScript[]
}

/** 规范化用户输入为 http://ip:port */
export function normalizeAddr(input: string): string | null {
  let t = input.trim()
  if (!t) return null
  if (!/^https?:\/\//.test(t)) t = 'http://' + t
  try {
    const u = new URL(t)
    if (!u.hostname) return null
    if (!u.port) u.port = '47832'
    return u.origin
  } catch {
    return null
  }
}

/** 从电脑拉取：本地与远端合并后写回（生词双向合并，跟读脚本取新） */
export async function pullFromDesktop(base: string): Promise<{ vocab: number; shadowing: number }> {
  const r = await fetch(base + '/export')
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const payload = (await r.json()) as SyncPayload
  const merged = mergeVocab(await vocabList(), payload.vocab ?? [])
  await vocabReplaceAll(merged)
  await shadowingMerge(payload.shadowing ?? [])
  return { vocab: merged.length, shadowing: (await shadowingList()).length }
}

/** 推送到电脑：发本地全量，电脑端合并（返回合并后的总数） */
export async function pushToDesktop(base: string): Promise<{ vocab: number; shadowing: number }> {
  const payload: SyncPayload = {
    version: 1,
    exportedAt: Date.now(),
    vocab: await vocabList(),
    shadowing: await shadowingList()
  }
  const r = await fetch(base + '/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return (await r.json()) as { vocab: number; shadowing: number }
}
