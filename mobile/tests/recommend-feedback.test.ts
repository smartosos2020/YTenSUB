import { beforeEach, describe, expect, it } from 'vitest'
import {
  emptyFeedback,
  loadFeedback,
  markNotInterestedChannel,
  markNotInterestedVideo,
  markWatched,
  normalizeFeedback,
  saveFeedback
} from '../src/lib/curated-feedback'
import { CuratedVideo, rankCurated } from '../src/lib/curated'
import { bandIndexOf, estimateLevelFromAnswers, LEVEL_BANDS, LEVEL_TEST_WORDS } from '../src/lib/level-test'
import { __resetAsyncStorage } from './mocks/async-storage'

// curated-feedback / rankCurated+feedback / level-test 三部分与根仓库 tests/recommend-feedback.test.ts 逐例一致
//（两端源码除文件头注释外完全相同；level-test 的 CefrLevel 在手机端本地定义，见 src/lib/level-test.ts）。

describe('curated-feedback', () => {
  it('normalize：去重 + 非字符串过滤 + 损坏兜底', () => {
    expect(normalizeFeedback({ notInterestedVideos: ['a', 'a', 1], notInterestedChannels: 'x', watchedVideos: null }))
      .toEqual({ notInterestedVideos: ['a'], notInterestedChannels: [], watchedVideos: [] })
    expect(normalizeFeedback(undefined)).toEqual({ notInterestedVideos: [], notInterestedChannels: [], watchedVideos: [] })
  })
  it('标记幂等不重复', () => {
    let fb = normalizeFeedback(undefined)
    fb = markNotInterestedVideo(fb, 'v1')
    fb = markNotInterestedVideo(fb, 'v1')
    fb = markNotInterestedChannel(fb, 'c1')
    fb = markWatched(fb, 'v2')
    expect(fb).toEqual({ notInterestedVideos: ['v1'], notInterestedChannels: ['c1'], watchedVideos: ['v2'] })
  })
})

describe('curated-feedback 持久化（AsyncStorage mock）', () => {
  beforeEach(() => __resetAsyncStorage())
  it('无存档 → 空反馈；写读回环一致', async () => {
    expect(await loadFeedback()).toEqual(emptyFeedback())
    const fb = markWatched(markNotInterestedVideo(emptyFeedback(), 'v1'), 'v2')
    await saveFeedback(fb)
    expect(await loadFeedback()).toEqual(fb)
  })
  it('损坏 JSON → 空反馈兜底', async () => {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default
    await AsyncStorage.setItem('ytensub:curated-feedback-v1', '{broken')
    expect(await loadFeedback()).toEqual(emptyFeedback())
  })
})

describe('rankCurated + feedback', () => {
  const mk = (videoId: string, channelId: string, level = 'B1'): CuratedVideo => ({
    videoId, title: videoId, channel: channelId, channelId, duration: 600, level,
    tags: ['教育'], ytCategory: 'Education', thumbnail: '', publishedAt: 1, fetchedAt: 1
  })
  const prefs = { level: 'B1', tags: ['教育'] }

  it('不感兴趣的视频被隐藏', () => {
    const out = rankCurated([mk('a', 'c1'), mk('b', 'c2')], prefs, new Set(), 'seed',
      { notInterestedVideos: ['a'], notInterestedChannels: [], watchedVideos: [] })
    expect(out.map((v) => v.videoId)).toEqual(['b'])
  })
  it('不感兴趣的频道沉底（不隐藏）', () => {
    const out = rankCurated([mk('a', 'c1'), mk('b', 'c2')], prefs, new Set(), 'seed',
      { notInterestedVideos: [], notInterestedChannels: ['c1'], watchedVideos: [] })
    expect(out[out.length - 1].channelId).toBe('c1')
    expect(out).toHaveLength(2)
  })
  it('已看完沉底，力度同已收藏', () => {
    const out = rankCurated([mk('a', 'c1'), mk('b', 'c2')], prefs, new Set(), 'seed',
      { notInterestedVideos: [], notInterestedChannels: [], watchedVideos: ['a'] })
    expect(out[out.length - 1].videoId).toBe('a')
  })
  it('不传 feedback 行为不变（向后兼容）', () => {
    const vids = [mk('a', 'c1'), mk('b', 'c2')]
    expect(rankCurated(vids, prefs, new Set(), 'seed')).toHaveLength(2)
  })
})

describe('level-test', () => {
  it('词表 24 词，全部落在档位内', () => {
    expect(LEVEL_TEST_WORDS).toHaveLength(24)
    for (const w of LEVEL_TEST_WORDS) expect(bandIndexOf(w.f)).toBeGreaterThanOrEqual(0)
  })
  it('全认识 → C2；只认识前两档 → A2', () => {
    const all = estimateLevelFromAnswers(LEVEL_TEST_WORDS.map((x) => ({ w: x.w, known: true })))
    expect(all).toBe('C2')
    const twoBands = estimateLevelFromAnswers(
      LEVEL_TEST_WORDS.map((x) => ({ w: x.w, known: bandIndexOf(x.f) <= 1 }))
    )
    expect(twoBands).toBe('A2')
  })
  it('全不认识 → 兜底 A1；答题不足一半 → null', () => {
    expect(estimateLevelFromAnswers(LEVEL_TEST_WORDS.map((x) => ({ w: x.w, known: false })))).toBe('A1')
    expect(estimateLevelFromAnswers([{ w: 'only', known: true }])).toBe(null)
  })
  it('档位表与 CEFR 顺序一致', () => {
    expect(LEVEL_BANDS.map((b) => b.level)).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'])
  })
})
