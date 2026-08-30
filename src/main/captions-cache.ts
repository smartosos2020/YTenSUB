import fs from 'node:fs'
import path from 'node:path'
import { Cue } from '../shared/captions'

/** 一条字幕缓存：解析好的英/中 cue + 视频信息 + 最近使用锚点 */
export interface CaptionCacheEntry {
  title: string
  channel: string
  en: Cue[]
  /** 中文字幕（视频自带或 YouTube 机翻轨），无则 null */
  zh: Cue[] | null
  /** 最近观看锚点：每次命中/写入都刷新，LRU 淘汰按它排序——常看的视频永远不会被当最旧清掉 */
  touchedAt: number
}

/** 容量上限：单条约几 KB，200 个视频几 MB，超出按最近使用淘汰 */
export const CAPTIONS_CACHE_MAX = 200

/**
 * 字幕本地缓存：独立 JSON 文件（captions-cache.json），与主数据文件分开，
 * 沿用防抖 + 原子写入 + .bak 备份的同一套安全模式。
 * 不依赖 electron，方便单元测试（由 main/index.ts 传入 userData 路径）。
 *
 * 注意：不纳入"导出数据"——缓存是加速层，丢了重新抓即可，不属于用户数据。
 */
export class CaptionsCache {
  /** Map 插入序即 LRU 序：头部最旧，尾部最新（get/put 都会把条目挪到尾部） */
  private map = new Map<string, CaptionCacheEntry>()
  private file: string
  private timer: NodeJS.Timeout | null = null

  constructor(file: string) {
    this.file = file
    this.load()
  }

  /** 依次尝试主文件和 .bak 备份，都损坏则从空缓存开始（缓存可重建，不算事故） */
  private load(): void {
    for (const f of [this.file, this.file + '.bak']) {
      try {
        const obj = JSON.parse(fs.readFileSync(f, 'utf8')) as Record<string, CaptionCacheEntry>
        // JSON 对象键序不一定反映 recency，按 touchedAt 重建 LRU 顺序
        this.map = new Map(
          Object.entries(obj)
            .filter(([, e]) => e && Array.isArray(e.en))
            .sort(([, a], [, b]) => a.touchedAt - b.touchedAt)
        )
        return
      } catch {
        // 文件不存在或损坏，尝试下一份
      }
    }
  }

  /** 命中即刷新锚点并挪到 LRU 尾部 */
  get(videoId: string): CaptionCacheEntry | null {
    const e = this.map.get(videoId)
    if (!e) return null
    this.map.delete(videoId)
    e.touchedAt = Date.now()
    this.map.set(videoId, e)
    this.scheduleSave()
    return e
  }

  /** 写入缓存；空英文字幕不缓存（可能是抓取失败，留给下次重试） */
  put(videoId: string, entry: Omit<CaptionCacheEntry, 'touchedAt'>): void {
    if (!videoId || entry.en.length === 0) return
    this.map.delete(videoId)
    this.map.set(videoId, { ...entry, touchedAt: Date.now() })
    // LRU 淘汰：头部最旧
    while (this.map.size > CAPTIONS_CACHE_MAX) {
      const oldest = this.map.keys().next().value
      if (oldest === undefined) break
      this.map.delete(oldest)
    }
    this.scheduleSave()
  }

  clear(): void {
    this.map.clear()
    this.scheduleSave()
  }

  get size(): number {
    return this.map.size
  }

  private scheduleSave(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 300)
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = this.file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.map)), 'utf8')
    // 覆盖前把上一份留作 .bak：主文件损坏时 load 可回滚
    try {
      if (fs.existsSync(this.file)) fs.copyFileSync(this.file, this.file + '.bak')
    } catch {
      // 备份失败不阻断写入
    }
    fs.renameSync(tmp, this.file)
  }
}
