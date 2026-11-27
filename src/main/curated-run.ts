import fs from 'node:fs'
import path from 'node:path'
import { CuratedPipeline, filterVideo, CuratedVideo, SeedChannel } from './curated'
import { fetchEnglishCues, type EnglishCuesResult } from './shadowing'
import { estimateLevelByFreq } from './cefr'
import { Dict } from './dict'
import { mapYtCategoryToTag } from '../shared/types'
import { emptyPipelineStats, type PipelineMetrics, type PipelineSummary } from '../shared/pipeline'

const REFRESH_MS = 30 * 86_400_000
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

/** Local collection. Preserve partial results, but never report failed collection as success. */
export async function runCuratedPipeline(opts: {
  apiKey: string
  dbPath: string
  seedPath: string
  dictPath: string
  fetchFn: FetchLike
  onLog: (m: string) => void
  onProgress?: (metrics: PipelineMetrics) => void
  extraSeeds?: SeedChannel[]
  sleep?: (ms: number) => Promise<void>
}): Promise<PipelineSummary> {
  const log = opts.onLog
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))
  const pipe = new CuratedPipeline({ apiKey: opts.apiKey, fetchFn: opts.fetchFn, onLog: log })
  const fileSeeds = JSON.parse(fs.readFileSync(opts.seedPath, 'utf8')) as SeedChannel[]
  const seeds = [...(opts.extraSeeds ?? []), ...fileSeeds]
  const db: Record<string, CuratedVideo> = fs.existsSync(opts.dbPath) ? JSON.parse(fs.readFileSync(opts.dbPath, 'utf8')) : {}
  const dict = new Dict(opts.dictPath)
  const now = Date.now()
  const stats = emptyPipelineStats()
  const repaired = new Set<string>()
  const visited = new Set<string>()
  const captions = new Map<string, EnglishCuesResult>()
  let added = 0, refreshed = 0, consecutiveFail = 0, stopped = ''
  const metrics = (): PipelineMetrics => ({ added, refreshed, repaired: repaired.size, total: Object.keys(db).length,
    stats: { ...stats, failureReasons: { ...stats.failureReasons } } })
  const progress = (): void => { opts.onProgress?.(metrics()) }
  const getCues = async (videoId: string): Promise<EnglishCuesResult> => {
    const cached = captions.get(videoId)
    if (cached) return cached
    stats.captionAttempts++
    let result = await fetchEnglishCues(videoId, opts.fetchFn)
    if ('error' in result && (result.error === 'rate-limited' || result.error === 'network-error' || result.error === 'http-error' && (result.status ?? 0) >= 500)) {
      await sleep(result.error === 'rate-limited' ? 4000 : 1000)
      result = await fetchEnglishCues(videoId, opts.fetchFn)
    }
    captions.set(videoId, result)
    if ('cues' in result) {
      stats.captionSucceeded++
      consecutiveFail = 0
    } else if (result.error === 'no-captions' || result.error === 'video-unavailable') {
      if (result.error === 'no-captions') stats.noCaptions++; else stats.unavailable++
      consecutiveFail = 0
      log('  跳过 ' + videoId + '：' + (result.error === 'no-captions' ? '无英文字幕轨' : '视频不可用') + (result.reason ? '（' + result.reason + '）' : ''))
    } else {
      stats.captionFailures++
      stats.failureReasons[result.error] = (stats.failureReasons[result.error] ?? 0) + 1
      const detail = [result.error, result.stage, result.status ? 'HTTP ' + result.status : '', result.reason].filter(Boolean).join('；')
      log('  ✗ ' + videoId + ' 字幕获取失败：' + detail)
      if (++consecutiveFail >= 3) stopped = '连续 3 个视频字幕请求失败（' + detail + '），已停止采集，请检查网络、代理或字幕接口后重试'
    }
    progress()
    await sleep(300)
    return result
  }

  const catMap = await pipe.videoCategoryMap()
  const catName = (id: string): string => catMap.get(id) ?? ''
  const untagged = Object.values(db).filter(e => !(e.tags ?? []).length)
  if (untagged.length) {
    try {
      const idMap = await pipe.videoCategoryIds(untagged.map(e => e.videoId))
      for (const e of untagged) {
        const tag = mapYtCategoryToTag(catName(idMap.get(e.videoId) ?? ''))
        if (tag) { e.tags = [tag]; e.categoryId = idMap.get(e.videoId) ?? ''; repaired.add(e.videoId) }
      }
    } catch { stats.channelFailures++; log('回填分类失败，请检查 YouTube Data API；继续保留已有分类') }
  }

  // A single request repairs both missing level and missing cues. Reuse existing cues first.
  for (const e of Object.values(db)) {
    if (stopped) break
    if (e.level && e.cues?.length) continue
    const result = e.cues?.length ? { cues: e.cues } : await getCues(e.videoId)
    if ('cues' in result) {
      if (!e.cues?.length) { e.cues = result.cues; repaired.add(e.videoId) }
      if (!e.level) {
        const level = estimateLevelByFreq(result.cues, dict)
        if (level) { e.level = level; repaired.add(e.videoId) }
      }
    }
  }
  if (repaired.size) log('补全旧条目：' + repaired.size + ' 部')
  progress()

  for (const seed of seeds) {
    if (stopped) break
    try {
      const cid = await pipe.resolveChannelId(seed)
      if (!cid) { stats.channelFailures++; log('✗ ' + seed.name + '：频道解析失败'); continue }
      if (!seed.channelId) seed.channelId = cid
      const ids = await pipe.listRecentVideoIds(cid, 15)
      const fresh = ids.filter(id => !visited.has(id) && (!db[id] || now - db[id].fetchedAt > REFRESH_MS))
      fresh.forEach(id => visited.add(id))
      stats.candidates += fresh.length
      if (!fresh.length) { log('= ' + seed.name + '：无待采集或刷新视频'); continue }
      const details = (await pipe.detailVideos(fresh)).filter(filterVideo)
      stats.eligible += details.length
      log('· ' + seed.name + '：' + fresh.length + ' 部待采集或刷新，' + details.length + ' 部通过基本筛选')
      progress()
      for (const v of details) {
        if (stopped) break
        const caps = await getCues(v.videoId)
        if ('error' in caps) continue
        const level = estimateLevelByFreq(caps.cues, dict)
        const tag = mapYtCategoryToTag(catName(v.categoryId)) || mapYtCategoryToTag(caps.category)
        const existed = !!db[v.videoId]
        db[v.videoId] = {
          videoId: v.videoId, title: v.title, channel: v.channelTitle, channelId: v.channelId,
          duration: v.durationSec, level, tags: tag ? [tag] : [], ytCategory: caps.category,
          categoryId: v.categoryId, thumbnail: 'https://i.ytimg.com/vi/' + v.videoId + '/hqdefault.jpg',
          publishedAt: Date.parse(v.publishedAt) || 0, fetchedAt: now, cues: caps.cues
        }
        if (existed) refreshed++; else added++
        progress()
      }
    } catch (error) {
      stats.channelFailures++
      // YouTube API errors only include operation + status, never credential-bearing URLs.
      log('✗ ' + seed.name + '：' + (error instanceof Error && /^YouTube API \w+ HTTP \d+$/.test(error.message) ? error.message : '频道采集失败，请检查网络或 API 配置'))
    }
  }

  fs.writeFileSync(opts.seedPath, JSON.stringify(fileSeeds, null, 2), 'utf8')
  if (added || refreshed || repaired.size || !fs.existsSync(opts.dbPath)) {
    fs.mkdirSync(path.dirname(opts.dbPath), { recursive: true })
    fs.writeFileSync(opts.dbPath + '.tmp', JSON.stringify(db, null, 2), 'utf8')
    fs.renameSync(opts.dbPath + '.tmp', opts.dbPath)
  }
  const incomplete = !!stopped || stats.captionFailures > 0 || stats.channelFailures > 0
  const state = incomplete ? added + refreshed + repaired.size > 0 ? 'partial' : 'failed' : 'success'
  const counts = '新增 ' + added + ' 部，刷新 ' + refreshed + ' 部，补全 ' + repaired.size + ' 部，库共 ' + Object.keys(db).length + ' 部；字幕成功 ' + stats.captionSucceeded + '/' + stats.captionAttempts + '，无英文字幕 ' + stats.noCaptions + '，请求失败 ' + stats.captionFailures
  const message = (state === 'success' ? '完成' : state === 'partial' ? '部分完成' : '采集失败') + '：' + counts + (stopped ? '；' + stopped : '')
  log(message)
  return { ...metrics(), state, message }
}
