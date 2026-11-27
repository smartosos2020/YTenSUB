import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runCuratedPipeline } from '../src/main/curated-run'
import type { CuratedVideo } from '../src/shared/curated'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }) })
type Outcome = 'ok' | 'timeout' | 'none' | 'login' | 'rate'
function oldVideo(id: string, days = 31): CuratedVideo {
  return { videoId: id, title: id, channel: 'Channel', channelId: 'c1', duration: 600, level: 'B1', tags: ['生活'], ytCategory: '', categoryId: '22', thumbnail: '', publishedAt: 0, fetchedAt: Date.now() - days * 86400000, cues: [{ start: 0, dur: 2, text: 'Old subtitle.' }] }
}
function fixture(ids: Record<string, string[]>, outcomes: Record<string, Outcome> = {}, db: Record<string, CuratedVideo> = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ytensub-curated-test-'))
  directories.push(directory)
  const dbPath = path.join(directory, 'content-db.json'), seedPath = path.join(directory, 'seeds.json'), dictPath = path.join(directory, 'dict.json')
  fs.writeFileSync(dbPath, JSON.stringify(db))
  fs.writeFileSync(seedPath, JSON.stringify(Object.keys(ids).map(channelId => ({ name: channelId, handle: '@' + channelId, topic: '', channelId }))))
  fs.writeFileSync(dictPath, JSON.stringify({ hello: { t: '你好', f: 1 } }))
  const requests: string[] = []
  const fetchFn = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input)
    if (url.pathname.endsWith('/videoCategories')) return Response.json({ items: [{ id: '22', snippet: { title: 'People & Blogs' } }] })
    if (url.pathname.endsWith('/channels')) return Response.json({ items: [{ contentDetails: { relatedPlaylists: { uploads: url.searchParams.get('id') } } }] })
    if (url.pathname.endsWith('/playlistItems')) return Response.json({ items: (ids[url.searchParams.get('playlistId')!] ?? []).map(videoId => ({ contentDetails: { videoId } })) })
    if (url.pathname.endsWith('/videos')) return Response.json({ items: url.searchParams.get('id')!.split(',').map(id => ({ id, snippet: { title: id, channelTitle: 'Channel', channelId: 'c1', publishedAt: '2026-11-01', defaultAudioLanguage: 'en', categoryId: '22' }, contentDetails: { duration: 'PT10M', caption: 'true' } })) })
    if (url.pathname.endsWith('/player')) {
      const { videoId } = JSON.parse(String(init?.body))
      requests.push(videoId)
      const outcome = outcomes[videoId] ?? 'ok'
      if (outcome === 'timeout') throw new Error('timeout', { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } })
      if (outcome === 'rate') return new Response('', { status: 429 })
      if (outcome === 'login') return Response.json({ playabilityStatus: { status: 'LOGIN_REQUIRED' } })
      return Response.json({ playabilityStatus: { status: 'OK' }, videoDetails: { title: videoId }, captions: { playerCaptionsTracklistRenderer: { captionTracks: outcome === 'none' ? [] : [{ languageCode: 'en', baseUrl: 'https://www.youtube.com/api/timedtext?id=' + videoId }] } } })
    }
    if (url.pathname.endsWith('/timedtext')) return Response.json({ events: [{ tStartMs: 0, dDurationMs: 60000, segs: [{ utf8: 'hello '.repeat(60) }] }] })
    throw new Error('Unexpected request ' + url.pathname)
  })
  const run = () => runCuratedPipeline({ apiKey: 'test', dbPath, seedPath, dictPath, fetchFn, onLog: vi.fn(), sleep: async () => {} })
  return { run, requests, dbPath }
}

describe('采集统计与失败处理', () => {
  it('新条目和30天刷新分别计数，并跳过刚采集的条目', async () => {
    const { run, dbPath } = fixture({ c1: ['new', 'old', 'recent'] }, {}, { old: oldVideo('old'), recent: oldVideo('recent', 1) })
    expect(await run()).toMatchObject({ state: 'success', added: 1, refreshed: 1, total: 3, stats: { candidates: 2, eligible: 2, captionAttempts: 2, captionSucceeded: 2 } })
    expect(JSON.parse(fs.readFileSync(dbPath, 'utf8')).new.cues).toHaveLength(1)
  })

  it('跨频道连续失败三次就停止，重试后仍失败不会报成功或改写旧库', async () => {
    const old = oldVideo('keep', 1)
    const { run, requests, dbPath } = fixture({ c1: ['a'], c2: ['b'], c3: ['c'], c4: ['d'] }, { a: 'timeout', b: 'timeout', c: 'timeout' }, { keep: old })
    const before = fs.readFileSync(dbPath, 'utf8')
    expect(await run()).toMatchObject({ state: 'failed', added: 0, total: 1, stats: { captionAttempts: 3, captionFailures: 3, failureReasons: { 'network-error': 3 } } })
    expect(requests).toEqual(['a', 'a', 'b', 'b', 'c', 'c'])
    expect(fs.readFileSync(dbPath, 'utf8')).toBe(before)
  })

  it('部分字幕成功时保留结果，并报告部分完成和失败原因', async () => {
    const { run, dbPath } = fixture({ c1: ['ok', 'bad'] }, { bad: 'login' })
    expect(await run()).toMatchObject({ state: 'partial', added: 1, total: 1, stats: { captionSucceeded: 1, captionFailures: 1, failureReasons: { 'player-error': 1 } } })
    expect(Object.keys(JSON.parse(fs.readFileSync(dbPath, 'utf8')))).toEqual(['ok'])
  })

  it('确实没有英文字幕属于正常跳过，429属于失败', async () => {
    expect(await fixture({ c1: ['none'] }, { none: 'none' }).run()).toMatchObject({ state: 'success', stats: { noCaptions: 1, captionFailures: 0 } })
    expect(await fixture({ c1: ['rate'] }, { rate: 'rate' }).run()).toMatchObject({ state: 'failed', stats: { noCaptions: 0, captionFailures: 1, failureReasons: { 'rate-limited': 1 } } })
  })

  it('已有字幕可本地补全难度，无需联网重抓字幕', async () => {
    const video = { ...oldVideo('old', 1), level: null, cues: [{ start: 0, dur: 60, text: 'hello '.repeat(60) }] }
    const { run, requests } = fixture({ c1: [] }, {}, { old: video })
    expect(await run()).toMatchObject({ state: 'success', repaired: 1, added: 0, stats: { captionAttempts: 0 } })
    expect(requests).toEqual([])
  })

  it('重叠频道和重复视频只采一次，缺少字幕和难度的旧条目共用一次请求', async () => {
    const video = { ...oldVideo('old', 1), level: null, cues: [] }
    const { run, requests } = fixture({ c1: ['new'], c2: ['new'] }, {}, { old: video })
    expect(await run()).toMatchObject({ state: 'success', added: 1, repaired: 1, stats: { captionAttempts: 2, captionSucceeded: 2 } })
    expect(requests).toEqual(['old', 'new'])
  })
})
