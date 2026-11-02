import AsyncStorage from '@react-native-async-storage/async-storage'
import { rankCurated as rankCuratedShared, type CuratedVideo as SharedCuratedVideo } from '../../../src/shared/curated'
import type { CuratedFeedback } from '../../../src/shared/curated-feedback'

import { CURATED_SNAPSHOT_URL, CURATED_INDEX_URL, CURATED_INC_URL_BASE } from '../../../src/shared/curated-config'

const CACHE_KEY = 'ytensub:curated-cache-v2'

// 会话级缓存：App 启动后第一次打开精选页才同步，之后整个会话直接用内存数据
let sessionCache: CuratedVideo[] | null = null
let lastSyncSucceeded = false

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
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000) })
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
export async function loadCurated(onCached?: (videos: CuratedVideo[]) => void): Promise<CuratedVideo[]> {
  if (sessionCache) {
    onCached?.(sessionCache)
    return sessionCache
  }

  let cache: LocalCache | null = null
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY)
    if (raw) cache = JSON.parse(raw)
  } catch {
    cache = null
  }

  // 先把持久化快照交给界面显示，再在后台请求索引和增量，避免进精选页时空等网络。
  if (cache?.db && typeof cache.db === 'object') {
    sessionCache = Object.values(cache.db)
    onCached?.(sessionCache)
  }

  const index = await fetchJson<CuratedIndex>(CURATED_INDEX_URL)
  lastSyncSucceeded = false
  if (index && Array.isArray(index.increments)) {
    lastSyncSucceeded = true
    const oldestTs = index.increments.length > 0 ? index.increments[0].ts : 0
    // appliedTs 落后于索引最早增量时回退全量引导
    const needBootstrap = !cache || cache.appliedTs < oldestTs

    if (needBootstrap) {
      // 没有本地库或落后太多：全量引导
      const full = await fetchJson<Record<string, CuratedVideo>>(CURATED_SNAPSHOT_URL)
      if (full) {
        cache = { db: full, appliedTs: index.latest }
        curatedLogSink?.(`curated: bootstrap ${Object.keys(full).length}`)
      } else {
        lastSyncSucceeded = false
      }
    } else if (cache && cache.appliedTs < index.latest) {
      // 补增量
      const pending = index.increments.filter((i) => i.ts > cache!.appliedTs)
      let applied = 0
      for (const inc of pending) {
        const entries = await fetchJson<Record<string, CuratedVideo>>(CURATED_INC_URL_BASE + inc.file)
        if (!entries) {
          lastSyncSucceeded = false
          break // 某个增量拉不到就先停在这（下次接着补）
        }
        Object.assign(cache.db, entries)
        cache.appliedTs = inc.ts
        applied += inc.count
      }
      if (applied > 0) curatedLogSink?.(`curated: +${applied} 增量（${pending.length} 个文件）`)
    } else {
      curatedLogSink?.('curated: 已是最新，零下载')
    }

    if (cache?.db) await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } else if (!index) {
    curatedLogSink?.('curated: index 拉取失败，用本地缓存')
  }

  if (cache?.db) {
    // 拿到真实数据（网络同步或本地缓存）才写会话缓存；都没有则保持 null，下次进页允许重试
    sessionCache = Object.values(cache.db)
    return sessionCache
  }
  return []
}

/** 手动刷新精选：重用本地快照作增量基线，网络失败时继续展示缓存。 */
export async function refreshCurated(
  onCached?: (videos: CuratedVideo[]) => void
): Promise<{ videos: CuratedVideo[]; updated: boolean }> {
  sessionCache = null
  lastSyncSucceeded = false
  const videos = await loadCurated(onCached)
  return { videos, updated: lastSyncSucceeded }
}

// 精选排序的唯一实现与桌面端共享，保持手机旧调用签名兼容。
export function rankCurated(
  videos: CuratedVideo[],
  prefs: { level: string | null; tags: string[] },
  seenIds: Set<string>,
  dateSeed: string,
  feedback?: CuratedFeedback
): CuratedVideo[] {
  return rankCuratedShared(
    videos as SharedCuratedVideo[],
    { ...prefs, level: prefs.level as import('../../../src/shared/types').CefrLevel | null },
    seenIds,
    dateSeed,
    feedback
  ) as CuratedVideo[]
}
