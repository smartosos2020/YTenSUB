/**
 * 精选内容管线（Phase 0 单机版）：
 * 种子频道 → YouTube Data API 拉最新视频 → 过滤（有字幕/时长/英文）→
 * 抓字幕定 CEFR 级（词频）→ 打标签（官方分类映射）→ 写本地 content-db.json。
 *
 * 由 scripts/content-pipeline.mjs 以 esbuild 打包后运行（不依赖 electron）。
 */

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
  /** 英文字幕（管线已抓，客户端免抓直接用——限流环境下精选视频字幕仍然秒出） */
  cues?: { start: number; dur: number; text: string }[]
}

export interface SeedChannel {
  name: string
  handle: string
  topic: string
  channelId?: string
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

/** ISO 8601 时长（PT1H2M3S）→ 秒 */
export function parseIso8601Duration(s: string): number {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(s)
  if (!m) return 0
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
}

export interface VideoDetail {
  videoId: string
  title: string
  channelTitle: string
  channelId: string
  publishedAt: string
  durationSec: number
  hasCaption: boolean
  language: string
  /** 数字分类 ID（snippet.categoryId），映射名字用 videoCategories.list */
  categoryId: string
}

/** 视频过滤：时长 3–90 分钟（播客/访谈较长）、非直播（时长 0）、英文（语言缺失时放行）。
 *  字幕有无不在此判断——官方 API 的 caption 标记对自动生成字幕不可靠，由抓字幕环节定夺 */
export function filterVideo(v: VideoDetail): boolean {
  if (v.durationSec < 180 || v.durationSec > 5400) return false
  if (v.language && !v.language.toLowerCase().startsWith('en')) return false
  return true
}

const API_BASE = 'https://www.googleapis.com/youtube/v3'

export interface PipelineDeps {
  apiKey: string
  fetchFn: FetchLike
  onLog?: (msg: string) => void
}

export class CuratedPipeline {
  private key: string
  private fetchFn: FetchLike
  private log: (msg: string) => void

  constructor(deps: PipelineDeps) {
    this.key = deps.apiKey
    this.fetchFn = deps.fetchFn
    this.log = deps.onLog ?? (() => {})
  }

  private async api(path: string, params: Record<string, string>): Promise<unknown> {
    const q = new URLSearchParams({ ...params, key: this.key })
    const r = await this.fetchFn(`${API_BASE}/${path}?${q}`)
    if (!r.ok) throw new Error(`YouTube API ${path} HTTP ${r.status}`)
    return r.json()
  }

  /** 解析频道 ID：handle 精确解析（1 unit）并校验有 uploads 播放列表，失败退化为 search（100 units，少用） */
  async resolveChannelId(seed: SeedChannel): Promise<string | null> {
    if (seed.channelId) return seed.channelId
    const byHandle = (await this.api('channels', {
      part: 'id',
      forHandle: seed.handle.replace(/^@/, '')
    })) as { items?: { id: string }[] }
    const viaHandle = byHandle.items?.[0]?.id
    if (viaHandle) {
      // 校验：handle 可能解析到死号/错号，确认有上传列表才算数
      const ch = (await this.api('channels', { part: 'contentDetails', id: viaHandle })) as {
        items?: { contentDetails?: { relatedPlaylists?: { uploads?: string } } }[]
      }
      if (ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads) return viaHandle
    }
    const bySearch = (await this.api('search', {
      part: 'id',
      type: 'channel',
      q: seed.name,
      maxResults: '1'
    })) as { items?: { id?: { channelId?: string } }[] }
    return bySearch.items?.[0]?.id?.channelId ?? null
  }

  /** 分类 ID → 名字映射（videoCategories.list，每次运行 1 unit） */
  async videoCategoryMap(): Promise<Map<string, string>> {
    const r = (await this.api('videoCategories', {
      part: 'snippet',
      regionCode: 'us',
      hl: 'en'
    })) as { items?: { id: string; snippet?: { title?: string } }[] }
    return new Map(
      (r.items ?? [])
        .map((i) => [i.id, i.snippet?.title ?? ''] as [string, string])
        .filter(([, t]) => !!t)
    )
  }

  /** 批量补分类 ID（回填老条目用），返回 videoId → categoryId */
  async videoCategoryIds(ids: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    for (const d of await this.detailVideos(ids)) out.set(d.videoId, d.categoryId)
    return out
  }

  /** 频道最新视频 ID 列表（uploads 播放列表；部分频道 uploads 不可读，404 时退化 search） */
  async listRecentVideoIds(channelId: string, max = 15): Promise<string[]> {
    const ch = (await this.api('channels', { part: 'contentDetails', id: channelId })) as {
      items?: { contentDetails?: { relatedPlaylists?: { uploads?: string } } }[]
    }
    const uploads = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
    if (uploads) {
      try {
        const pl = (await this.api('playlistItems', {
          part: 'contentDetails',
          playlistId: uploads,
          maxResults: String(max)
        })) as { items?: { contentDetails?: { videoId?: string } }[] }
        return (pl.items ?? []).map((i) => i.contentDetails?.videoId ?? '').filter(Boolean)
      } catch {
        // 落到 search 兜底
      }
    }
    const r = (await this.api('search', {
      part: 'id',
      type: 'video',
      channelId,
      order: 'date',
      maxResults: String(max)
    })) as { items?: { id?: { videoId?: string } }[] }
    return (r.items ?? []).map((i) => i.id?.videoId ?? '').filter(Boolean)
  }

  /** 批量取详情并过滤出适合学习的视频 */
  async detailVideos(ids: string[]): Promise<VideoDetail[]> {
    const out: VideoDetail[] = []
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50)
      const r = (await this.api('videos', {
        part: 'snippet,contentDetails',
        id: batch.join(',')
      })) as {
        items?: {
          id: string
          snippet: {
            title: string
            channelTitle: string
            channelId: string
            publishedAt: string
            defaultAudioLanguage?: string
            defaultLanguage?: string
            categoryId?: string
          }
          contentDetails: { duration: string; caption: string }
        }[]
      }
      for (const v of r.items ?? []) {
        out.push({
          videoId: v.id,
          title: v.snippet.title,
          channelTitle: v.snippet.channelTitle,
          channelId: v.snippet.channelId,
          publishedAt: v.snippet.publishedAt,
          durationSec: parseIso8601Duration(v.contentDetails.duration),
          hasCaption: v.contentDetails.caption === 'true',
          language: v.snippet.defaultAudioLanguage ?? v.snippet.defaultLanguage ?? '',
          categoryId: v.snippet.categoryId ?? ''
        })
      }
    }
    return out
  }
}
