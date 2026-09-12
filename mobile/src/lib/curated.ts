import AsyncStorage from '@react-native-async-storage/async-storage'

/** 精选内容快照公开地址（元数据全量引导，与桌面端 src/shared/curated-config.ts 同步） */
export const CURATED_SNAPSHOT_URL =
  'https://pub-c1dea26a05844ec7959997061df9f305.r2.dev/content-db.json'
/** 增量索引地址 */
export const CURATED_INDEX_URL =
  'https://pub-c1dea26a05844ec7959997061df9f305.r2.dev/index.json'
/** 增量文件地址前缀 */
export const CURATED_INC_URL_BASE =
  'https://pub-c1dea26a05844ec7959997061df9f305.r2.dev/'
/** 每视频字幕地址前缀：+ videoId + '.json'（R2 无限速，打开时按需取） */
export const CURATED_CUES_URL_BASE =
  'https://pub-c1dea26a05844ec7959997061df9f305.r2.dev/cues/'

const CACHE_KEY = 'ytensub:curated-cache-v2'
const INDEX_KEEP_FALLBACK = 0 // appliedTs 落后于索引最早增量时回退全量

// 会话级缓存：App 启动后第一次打开精选页才同步，之后整个会话直接用内存数据
let sessionCache: CuratedVideo[] | null = null

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
  /** 英文字幕（仅内嵌快照时存在；元数据快照/增量不含，按需从 cues/ 取） */
  cues?: { start: number; dur: number; text: string }[]
}

interface CuratedIndex {
  latest: number
  increments: { ts: number; file: string; count: number }[]
}

interface LocalCache {
  db: Record<string, CuratedVideo>
  appliedTs: number
}

/** 注册精选库加载的日志出口（App 启动时挂 BgPlayer.log，排查远端快照可达性） */
let curatedLogSink: ((msg: string) => void) | null = null
export function setCuratedLogSink(sink: (msg: string) => void): void {
  curatedLogSink = sink
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    return (await r.json()) as T
  } catch (e) {
    curatedLogSink?.(`curated: fetch fail ${url.slice(-30)} ${String(e)}`)
    return null
  }
}

/**
 * 读精选库（增量同步）：
 * 本次会话首次：拉 index.json（几百字节）→ 落后就引导全量或补增量，本地合并；
 * 之后整个会话直接用内存数据。网络失败回退本地缓存。
 */
export async function loadCurated(): Promise<CuratedVideo[]> {
  if (sessionCache) return sessionCache

  let cache: LocalCache | null = null
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY)
    if (raw) cache = JSON.parse(raw)
  } catch {
    cache = null
  }

  const index = await fetchJson<CuratedIndex>(CURATED_INDEX_URL)
  if (index && Array.isArray(index.increments)) {
    const oldestTs = index.increments.length > 0 ? index.increments[0].ts : 0
    const needBootstrap = !cache || cache.appliedTs < oldestTs - INDEX_KEEP_FALLBACK

    if (needBootstrap) {
      // 没有本地库或落后太多：全量引导
      const full = await fetchJson<Record<string, CuratedVideo>>(CURATED_SNAPSHOT_URL)
      if (full) {
        cache = { db: full, appliedTs: index.latest }
        curatedLogSink?.(`curated: bootstrap ${Object.keys(full).length}`)
      }
    } else if (cache && cache.appliedTs < index.latest) {
      // 补增量
      const pending = index.increments.filter((i) => i.ts > cache!.appliedTs)
      let applied = 0
      for (const inc of pending) {
        const entries = await fetchJson<Record<string, CuratedVideo>>(CURATED_INC_URL_BASE + inc.file)
        if (!entries) break // 某个增量拉不到就先停在这（下次接着补）
        Object.assign(cache.db, entries)
        cache.appliedTs = inc.ts
        applied += inc.count
      }
      if (applied > 0) curatedLogSink?.(`curated: +${applied} 增量（${pending.length} 个文件）`)
    } else {
      curatedLogSink?.('curated: 已是最新，零下载')
    }

    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } else if (!index) {
    curatedLogSink?.('curated: index 拉取失败，用本地缓存')
  }

  sessionCache = cache?.db ? Object.values(cache.db) : []
  return sessionCache
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
