import fs from 'node:fs'
import path from 'node:path'
import { CuratedPipeline, filterVideo, CuratedVideo, SeedChannel } from './curated'
import { fetchEnglishCues } from './shadowing'
import { estimateLevelByFreq } from './cefr'
import { Dict } from './dict'
import { mapYtCategoryToTag } from '../shared/types'

/** 30 天前的条目重抓刷新（YouTube API ToS 数据新鲜度要求） */
const REFRESH_MS = 30 * 86_400_000

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

/**
 * Phase 0 管线主流程（由 scripts/content-pipeline.mjs 打包运行）：
 * 种子频道逐个拉新视频 → 过滤 → 抓字幕定级 → 打标签 → 增量写入 content-db.json。
 * 解析到的 channelId 回写种子文件，下次省一次解析。
 */
export async function runCuratedPipeline(opts: {
  apiKey: string
  dbPath: string
  seedPath: string
  dictPath: string
  fetchFn: FetchLike
  onLog: (m: string) => void
}): Promise<void> {
  const log = opts.onLog
  const pipe = new CuratedPipeline({ apiKey: opts.apiKey, fetchFn: opts.fetchFn, onLog: log })
  const seeds = JSON.parse(fs.readFileSync(opts.seedPath, 'utf8')) as SeedChannel[]
  const db: Record<string, CuratedVideo> = fs.existsSync(opts.dbPath)
    ? (JSON.parse(fs.readFileSync(opts.dbPath, 'utf8')) as Record<string, CuratedVideo>)
    : {}
  const dict = new Dict(opts.dictPath)
  const now = Date.now()
  let added = 0

  // 官方分类 ID → 名字（打标签用）；innertube 的 ANDROID 响应没有 microformat，走官方 API
  const catMap = await pipe.videoCategoryMap()
  const catName = (id: string): string => catMap.get(id) ?? ''

  // 回填：库里 tags 为空的老条目，按 categoryId 补打（不动 level）
  const untagged = Object.values(db).filter((e) => (e.tags ?? []).length === 0)
  if (untagged.length > 0) {
    const idMap = await pipe.videoCategoryIds(untagged.map((e) => e.videoId))
    let fixed = 0
    for (const e of untagged) {
      const tag = mapYtCategoryToTag(catName(idMap.get(e.videoId) ?? ''))
      if (tag) {
        e.tags = [tag]
        e.categoryId = idMap.get(e.videoId) ?? ''
        fixed++
      }
    }
    if (fixed > 0) log(`回填标签：${fixed} 部`)
  }

  // 回填：level 为空的老条目，重抓字幕（innertube，非 Data API）按新阈值补估
  const noLevel = Object.values(db).filter((e) => !e.level)
  if (noLevel.length > 0) {
    let fixedLv = 0
    for (const e of noLevel) {
      const caps = await fetchEnglishCues(e.videoId, opts.fetchFn)
      if (caps) {
        const lv = estimateLevelByFreq(caps.cues, dict)
        if (lv) {
          e.level = lv
          fixedLv++
        }
      }
      await new Promise((r) => setTimeout(r, 400))
    }
    log(`回填难度：${fixedLv}/${noLevel.length} 部`)
  }

  // 回填：没有字幕的老条目，抓字幕存进快照（客户端免抓直接用）
  const noCues = Object.values(db).filter((e) => !(e.cues ?? []).length)
  if (noCues.length > 0) {
    let fixedCues = 0
    let cueFail = 0
    for (const e of noCues) {
      const caps = await fetchEnglishCues(e.videoId, opts.fetchFn)
      if (caps) {
        e.cues = caps.cues
        fixedCues++
        cueFail = 0
      } else if (++cueFail >= 3) {
        log('回填字幕遇限流，暂停（下次续传）')
        break
      }
      await new Promise((r) => setTimeout(r, 400))
    }
    log(`回填字幕：${fixedCues}/${noCues.length} 部`)
  }

  for (const seed of seeds) {
    try {
      const cid = await pipe.resolveChannelId(seed)
      if (!cid) {
        log(`✗ ${seed.name}：频道解析失败（handle 可能不对）`)
        continue
      }
      if (!seed.channelId) seed.channelId = cid // 缓存，省下次解析
      const ids = await pipe.listRecentVideoIds(cid, 15)
      const fresh = ids.filter((id) => !db[id] || now - db[id].fetchedAt > REFRESH_MS)
      if (fresh.length === 0) {
        log(`= ${seed.name}：无新视频`)
        continue
      }
      const details = (await pipe.detailVideos(fresh)).filter(filterVideo)
      log(`· ${seed.name}：${fresh.length} 新视频，${details.length} 部合格`)
      let consecutiveFail = 0
      for (const v of details) {
        try {
          // 限流重试一次（429 是当天常态：Google 按 IP 限速），连续失败 3 次提前收工
          let caps = await fetchEnglishCues(v.videoId, opts.fetchFn)
          if (!caps) {
            await new Promise((r) => setTimeout(r, 4000))
            caps = await fetchEnglishCues(v.videoId, opts.fetchFn)
          }
          if (!caps) {
            consecutiveFail++
            if (consecutiveFail >= 3) {
              log('连续 3 部抓不到字幕，可能被限流（429）——今天到此为止，明天再跑即可增量续传')
              throw new Error('rate-limited')
            }
            continue
          }
          consecutiveFail = 0
          const level = estimateLevelByFreq(caps.cues, dict)
          const tag = mapYtCategoryToTag(catName(v.categoryId)) || mapYtCategoryToTag(caps.category)
          db[v.videoId] = {
            videoId: v.videoId,
            title: v.title,
            channel: v.channelTitle,
            channelId: v.channelId,
            duration: v.durationSec,
            level,
            tags: tag ? [tag] : [],
            ytCategory: caps.category,
            categoryId: v.categoryId,
            thumbnail: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
            publishedAt: Date.parse(v.publishedAt) || 0,
            fetchedAt: now,
            cues: caps.cues // 字幕随快照分发：客户端打开精选视频直接用，不必再抓（限流环境下也秒出）
          }
          added++
          await new Promise((r) => setTimeout(r, 250)) // 字幕抓取限速，温柔一点
        } catch (e) {
          if ((e as Error).message === 'rate-limited') throw e // 限流哨兵穿透
          log(`  ✗ ${v.videoId} 字幕/定级失败：${String(e)}`)
        }
      }
    } catch (e) {
      if ((e as Error).message === 'rate-limited') {
        log('管线提前结束（限流），已入库部分已保存')
        break
      }
      log(`✗ ${seed.name}：${String(e)}`)
    }
  }

  fs.writeFileSync(opts.seedPath, JSON.stringify(seeds, null, 2), 'utf8')
  const tmp = opts.dbPath + '.tmp'
  fs.mkdirSync(path.dirname(opts.dbPath), { recursive: true })
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8')
  fs.renameSync(tmp, opts.dbPath)
  log(`完成：新增 ${added} 部，库共 ${Object.keys(db).length} 部`)
}
