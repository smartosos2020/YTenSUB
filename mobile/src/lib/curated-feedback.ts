/**
 * 精选推荐的用户反馈（⑨）：与桌面端 src/shared/curated-feedback.ts 同源（同步拷贝）。
 * 不感兴趣（视频隐藏/频道沉底）、已看完（沉底）。
 * 反馈存本地（桌面主库 / 手机 AsyncStorage），不上云。
 * 下半部分是手机端新增：AsyncStorage 持久化。
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  emptyFeedback,
  normalizeFeedback,
  markNotInterestedVideo,
  markNotInterestedChannel,
  markWatched
} from '../../../src/shared/curated-feedback'
import type { CuratedFeedback } from '../../../src/shared/curated-feedback'

export {
  emptyFeedback,
  normalizeFeedback,
  markNotInterestedVideo,
  markNotInterestedChannel,
  markWatched
}
export type { CuratedFeedback }

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
