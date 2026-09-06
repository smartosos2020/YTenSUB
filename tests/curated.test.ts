import { describe, expect, it } from 'vitest'
import { CuratedVideo, rankCurated } from '../src/shared/curated'

function v(id: string, level: string | null, tags: string[] = []): CuratedVideo {
  return {
    videoId: id, title: id, channel: 'c', channelId: 'c', duration: 300,
    level, tags, ytCategory: '', thumbnail: '', publishedAt: 0, fetchedAt: 0
  }
}

describe('rankCurated 推荐排序', () => {
  const videos = [v('exact', 'B1'), v('near', 'B2'), v('far', 'C2'), v('tagged', 'B1', ['科技']), v('none', null)]

  it('难度贴近优先，标签命中加权，看过的沉底', () => {
    const r = rankCurated(videos, { level: 'B1', tags: [] }, new Set(), '2026-09-05')
    // 精确匹配的两部（exact/tagged 同分，哈希定序）在前二，相邻级 near 第三，跨级 far 垫底
    expect(r.map((x) => x.videoId).slice(0, 2).sort()).toEqual(['exact', 'tagged'])
    expect(r[2].videoId).toBe('near')
    expect(r[r.length - 1].videoId).toBe('far')

    const r2 = rankCurated(videos, { level: 'B1', tags: ['科技'] }, new Set(), '2026-09-05')
    expect(r2[0].videoId).toBe('tagged')

    const r3 = rankCurated(videos, { level: 'B1', tags: [] }, new Set(['exact']), '2026-09-05')
    expect(r3[0].videoId).not.toBe('exact')
  })

  it('同一天稳定；多个不同日期中至少有一天换序', () => {
    const a = rankCurated(videos, { level: null, tags: [] }, new Set(), '2026-09-05').map((x) => x.videoId)
    const b = rankCurated(videos, { level: null, tags: [] }, new Set(), '2026-09-05').map((x) => x.videoId)
    expect(a).toEqual(b)
    // 哈希打散不保证每天都换序，但一批日期里至少有一天不同
    const differs = ['2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10'].some(
      (d) =>
        rankCurated(videos, { level: null, tags: [] }, new Set(), d)
          .map((x) => x.videoId)
          .join() !== a.join()
    )
    expect(differs).toBe(true)
  })
})
