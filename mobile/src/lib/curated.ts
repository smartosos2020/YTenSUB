import AsyncStorage from '@react-native-async-storage/async-storage'

/** 精选内容快照公开地址（与桌面端 src/shared/curated-config.ts 同步） */
export const CURATED_SNAPSHOT_URL =
  'https://pub-c1dea26a05844ec7959997061df9f305.r2.dev/content-db.json'

const CACHE_KEY = 'ytensub:curated-cache'

export interface CuratedVideo {
  videoId: string
  title: string
  channel: string
  channelId: string
  duration: number
  level: string | null
  tags: string[]
  ytCategory: string
  thumbnail: string
  publishedAt: number
  fetchedAt: number
  /** 英文字幕（快照自带，免抓取） */
  cues?: { start: number; dur: number; text: string }[]
}

/** 读精选库：HEAD 比较远端更新时间，比本地新就换快照；失败回退本地缓存 */
export async function loadCurated(): Promise<CuratedVideo[]> {
  let cached: { ts: number; data: CuratedVideo[] } | null = null
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY)
    if (raw) cached = JSON.parse(raw)
  } catch {
    cached = null
  }
  if (CURATED_SNAPSHOT_URL) {
    try {
      // HEAD 拿 Last-Modified：远端更新才下载完整快照（~3MB）
      const head = await fetch(CURATED_SNAPSHOT_URL, { method: 'HEAD' })
      const remoteTs = Date.parse(head.headers.get('Last-Modified') ?? '') || 0
      if (!cached || remoteTs > cached.ts) {
        const r = await fetch(CURATED_SNAPSHOT_URL)
        if (r.ok) {
          const obj = (await r.json()) as Record<string, CuratedVideo>
          const data = Object.values(obj)
          await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ ts: remoteTs || Date.now(), data }))
          return data
        }
      }
    } catch {
      // 网络失败回退缓存
    }
  }
  return cached?.data ?? []
}

/** 与桌面端 rankCurated 同规则的简化版：难度贴近 + 标签命中 + 已收藏沉底 + 日期种子打散 */
export function rankCurated(
  videos: CuratedVideo[],
  prefs: { level: string | null; tags: string[] },
  seenIds: Set<string>,
  dateSeed: string
): CuratedVideo[] {
  const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
  const lvIdx = (l: string | null): number => (l ? LEVELS.indexOf(l) : -1)
  const pref = lvIdx(prefs.level)
  const hash = (s: string): number => {
    let h = 5381
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
    return h
  }
  return videos
    .map((v) => {
      let score = 0
      const vi = lvIdx(v.level)
      if (pref >= 0 && vi >= 0) {
        const d = Math.abs(vi - pref)
        score += d === 0 ? 3 : d === 1 ? 2 : d === 2 ? 1 : 0.2
      } else score += 1
      if (prefs.tags.length > 0 && v.tags.some((t) => prefs.tags.includes(t))) score += 2
      if (seenIds.has(v.videoId)) score -= 2
      return { v, score, tie: hash(dateSeed + v.videoId) }
    })
    .sort((a, b) => b.score - a.score || a.tie - b.tie)
    .map((s) => s.v)
}
