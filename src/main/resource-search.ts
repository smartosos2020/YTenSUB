import type { ResourceResult } from '../shared/resources'
import { fetchWithDeadline, parseEpisodeInfo } from './local-media'
import { RESOURCE_TRACKERS } from './resource-trackers'

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

/** TPB's ApiBay adapter. Only video categories enter our results. */
export async function searchResources(query: string, fetchFn: FetchFn): Promise<ResourceResult[]> {
  if (typeof query !== 'string' || !query.trim() || query.length > 160) throw new Error('请输入剧名或关键词（最多 160 字）')
  const text = query.trim()
  const response = await fetchWithDeadline(fetchFn,
    `https://apibay.org/q.php?${new URLSearchParams({ q: text, cat: '200' })}`, {}, 20_000,
    '资源搜索超时，请检查网络或代理后重试')
  if (!response.ok) throw new Error(`资源搜索失败：HTTP ${response.status}`)
  const body = await response.text()
  if (body.length > 2_000_000) throw new Error('搜索结果过大，请缩小搜索范围')
  let rows: unknown
  try { rows = JSON.parse(body) } catch { throw new Error('资源源站暂时不可用，请稍后重试') }
  if (!Array.isArray(rows)) throw new Error('资源源站返回了无效结果')
  const expected = parseEpisodeInfo(text)
  const terms = (expected.episode === undefined ? text : expected.query)
    .toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  const unique = new Map<string, ResourceResult>()
  for (const raw of rows.slice(0, 1000)) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as Record<string, unknown>
    const hash = String(row.info_hash ?? '').toLowerCase()
    const name = String(row.name ?? '').slice(0, 600)
    const category = Number(row.category)
    if (!/^[a-f0-9]{40}$/.test(hash) || /^0+$/.test(hash) || !name || category < 200 || category >= 300 || !Number.isFinite(category)) continue
    const words = new Set(name.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    if (!terms.every((term) => words.has(term))) continue
    if (expected.episode !== undefined) {
      const actual = parseEpisodeInfo(name)
      if (actual.season !== expected.season || actual.episode !== expected.episode) continue
    }
    const count = (key: string): number => Number.isFinite(Number(row[key])) ? Math.max(0, Number(row[key])) : 0
    const magnet = new URLSearchParams({ xt: `urn:btih:${hash}`, dn: name })
    for (const tracker of RESOURCE_TRACKERS) magnet.append('tr', tracker)
    unique.set(hash, {
      id: hash, name, size: count('size'), seeders: count('seeders'), leechers: count('leechers'),
      added: count('added') * 1000,
      magnet: `magnet:?${magnet}`,
      sourceUrl: /^\d+$/.test(String(row.id)) ? `https://thepiratebay.org/description.php?id=${row.id}` : 'https://thepiratebay.org/'
    })
  }
  return [...unique.values()].sort((a, b) => b.seeders - a.seeders || b.added - a.added).slice(0, 100)
}
