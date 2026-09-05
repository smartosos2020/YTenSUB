import AsyncStorage from '@react-native-async-storage/async-storage'
import { Cue } from './captions'

/**
 * 移动端字幕缓存（与桌面端 captions-cache 同思路）：
 * videoId → 解析好的英/中 cue + 标题；LRU 上限 100 部，
 * 命中即刷新 touchedAt（最近观看锚点），淘汰最久未看的。
 */
export interface CapCacheEntry {
  title: string
  en: Cue[]
  zh: Cue[] | null
  touchedAt: number
}

const KEY = 'ytensub:capcache'
const MAX = 100

type CacheMap = Record<string, CapCacheEntry>

async function readAll(): Promise<CacheMap> {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as CacheMap) : {}
  } catch {
    return {}
  }
}

export async function capcacheGet(videoId: string): Promise<CapCacheEntry | null> {
  const map = await readAll()
  const hit = map[videoId]
  if (!hit || !Array.isArray(hit.en)) return null
  // 刷新锚点（异步写回，不阻塞读取）
  hit.touchedAt = Date.now()
  void AsyncStorage.setItem(KEY, JSON.stringify(map)).catch(() => {})
  return hit
}

export async function capcachePut(
  videoId: string,
  entry: { title: string; en: Cue[]; zh: Cue[] | null }
): Promise<void> {
  if (!videoId || entry.en.length === 0) return // 空字幕不缓存，留给下次重试
  const map = await readAll()
  map[videoId] = { ...entry, touchedAt: Date.now() }
  // LRU：超出上限按锚点淘汰最旧
  const entries = Object.entries(map)
  if (entries.length > MAX) {
    entries.sort(([, a], [, b]) => a.touchedAt - b.touchedAt)
    for (let i = 0; i < entries.length - MAX; i++) delete map[entries[i][0]]
  }
  await AsyncStorage.setItem(KEY, JSON.stringify(map))
}
