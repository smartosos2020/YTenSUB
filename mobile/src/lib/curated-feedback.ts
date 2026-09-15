/**
 * 精选推荐的用户反馈（⑨）：与桌面端 src/shared/curated-feedback.ts 同源（同步拷贝）。
 * 不感兴趣（视频隐藏/频道沉底）、已看完（沉底）。
 * 反馈存本地（桌面主库 / 手机 AsyncStorage），不上云。
 * 下半部分是手机端新增：AsyncStorage 持久化。
 */
import AsyncStorage from '@react-native-async-storage/async-storage'

export interface CuratedFeedback {
  /** 不感兴趣的视频（直接隐藏） */
  notInterestedVideos: string[]
  /** 不感兴趣的频道（channelId，沉底） */
  notInterestedChannels: string[]
  /** 已看完的视频（沉底，与已收藏同等力度） */
  watchedVideos: string[]
}

export function emptyFeedback(): CuratedFeedback {
  return { notInterestedVideos: [], notInterestedChannels: [], watchedVideos: [] }
}

/** 各类名单上限（防无限增长撑大本地存储） */
const FEEDBACK_CAP = 500

/** 清洗/规范化外部读入的反馈（旧数据或损坏数据兜底） */
export function normalizeFeedback(raw: unknown): CuratedFeedback {
  const list = (v: unknown): string[] =>
    Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string'))].slice(-FEEDBACK_CAP) : []
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    notInterestedVideos: list(r.notInterestedVideos),
    notInterestedChannels: list(r.notInterestedChannels),
    watchedVideos: list(r.watchedVideos)
  }
}

export function markNotInterestedVideo(fb: CuratedFeedback, videoId: string): CuratedFeedback {
  if (fb.notInterestedVideos.includes(videoId)) return fb
  return normalizeFeedback({ ...fb, notInterestedVideos: [...fb.notInterestedVideos, videoId] })
}

export function markNotInterestedChannel(fb: CuratedFeedback, channelId: string): CuratedFeedback {
  if (fb.notInterestedChannels.includes(channelId)) return fb
  return normalizeFeedback({ ...fb, notInterestedChannels: [...fb.notInterestedChannels, channelId] })
}

export function markWatched(fb: CuratedFeedback, videoId: string): CuratedFeedback {
  if (fb.watchedVideos.includes(videoId)) return fb
  return normalizeFeedback({ ...fb, watchedVideos: [...fb.watchedVideos, videoId] })
}

/* ---------- 以下为手机端新增 ---------- */

const FEEDBACK_KEY = 'ytensub:curated-feedback-v1'

/** 读反馈（过 normalizeFeedback 清洗）；无/损坏/读取失败兜底 emptyFeedback */
export async function loadFeedback(): Promise<CuratedFeedback> {
  try {
    const raw = await AsyncStorage.getItem(FEEDBACK_KEY)
    return normalizeFeedback(raw ? JSON.parse(raw) : null)
  } catch {
    return emptyFeedback()
  }
}

/** 写反馈；失败静默（下次启动回到已存值） */
export async function saveFeedback(fb: CuratedFeedback): Promise<void> {
  try {
    await AsyncStorage.setItem(FEEDBACK_KEY, JSON.stringify(fb))
  } catch {
    /* 持久化失败不阻塞界面 */
  }
}
