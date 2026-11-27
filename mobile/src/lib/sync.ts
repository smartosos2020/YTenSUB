import {
  shadowingMerge,
  shadowingList,
  ShadowingScript,
  VocabItem,
  vocabList,
  vocabMerge
} from './storage'

/** 与桌面端 SyncPayload 同构 */
interface SyncPayload {
  version: number
  exportedAt: number
  vocab: VocabItem[]
  shadowing: ShadowingScript[]
}

/** RN/Hermes 兼容的带超时 JSON 请求（覆盖发起请求与正文解析全过程） */
async function fetchJsonWithTimeout<T>(url: string, init: RequestInit, timeoutMs = 10_000): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new Error('请求超时'))
    }, timeoutMs)
  })
  try {
    return await Promise.race([
      (async () => {
        const r = await fetch(url, { ...init, signal: controller.signal })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return (await r.json()) as T
      })(),
      deadline
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
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

/** 从电脑拉取：本地与远端原子合并后写回（生词双向合并，跟读脚本取新） */
export async function pullFromDesktop(
  base: string,
  token: string | null
): Promise<{ vocab: number; shadowing: number }> {
  const payload = await fetchJsonWithTimeout<SyncPayload>(base + '/export', {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  })
  const merged = await vocabMerge(payload.vocab ?? [])
  await shadowingMerge(payload.shadowing ?? [])
  return { vocab: merged.length, shadowing: (await shadowingList()).length }
}

/** 推送到电脑：发本地全量，电脑端合并（返回合并后的总数） */
export async function pushToDesktop(
  base: string,
  token: string | null
): Promise<{ vocab: number; shadowing: number }> {
  const payload: SyncPayload = {
    version: 1,
    exportedAt: Date.now(),
    vocab: await vocabList(),
    shadowing: await shadowingList()
  }
  return fetchJsonWithTimeout<{ vocab: number; shadowing: number }>(base + '/import', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(payload)
  })
}
