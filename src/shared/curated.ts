import { CefrLevel, CEFR_LEVELS } from './types'

/** 精选库视频条目（与 content-db.json 同构） */
export interface CuratedVideo {
  videoId: string
  title: string
  channel: string
  channelId: string
  duration: number
  level: string | null
  tags: string[]
  ytCategory: string
  /** 官方数字分类 ID（回填标签用；老条目可能没有） */
  categoryId?: string
  thumbnail: string
  publishedAt: number
  fetchedAt: number
}

export interface CuratedPrefs {
  /** 用户自评水平；null = 不按难度过滤 */
  level: CefrLevel | null
  /** 订阅标签；空 = 不按标签过滤 */
  tags: string[]
}

/** 确定性哈希（同一天同一用户看到同一批推荐） */
function hashStr(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h
}

const levelIdx = (l: string | null): number => (l ? CEFR_LEVELS.indexOf(l as CefrLevel) : -1)

/**
 * 推荐排序：难度贴近优先（精确 > 相邻 > 跨两级 > 未评估），标签命中加分，
 * 已收藏/看过的沉底；同分按 日期种子+videoId 哈希打散（当天稳定、明日换新）。
 */
export function rankCurated(
  videos: CuratedVideo[],
  prefs: CuratedPrefs,
  seenIds: Set<string>,
  dateSeed: string
): CuratedVideo[] {
  const prefLv = prefs.level ? levelIdx(prefs.level) : -1
  const scored = videos.map((v) => {
    let score = 0
    const vi = levelIdx(v.level)
    if (prefLv >= 0 && vi >= 0) {
      const diff = Math.abs(vi - prefLv)
      score += diff === 0 ? 3 : diff === 1 ? 2 : diff === 2 ? 1 : 0.2
    } else {
      score += 1 // 未设水平或视频未评估：中性
    }
    if (prefs.tags.length > 0 && v.tags.some((t) => prefs.tags.includes(t))) score += 2
    if (seenIds.has(v.videoId)) score -= 2
    return { v, score, tie: hashStr(dateSeed + v.videoId) }
  })
  return scored.sort((a, b) => b.score - a.score || a.tie - b.tie).map((s) => s.v)
}
