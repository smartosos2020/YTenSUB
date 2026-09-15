/**
 * 精选推荐的用户反馈（⑨）：不感兴趣（视频隐藏/频道沉底）、已看完（沉底）。
 * 反馈存本地（桌面主库 / 手机 AsyncStorage），不上云。
 */

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
