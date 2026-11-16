import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { VocabVisualRequest, VocabVisualResult } from '../shared/vocab-visual'

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

interface StoredVisual extends Omit<VocabVisualResult, 'imageDataUrl'> {
  fileName?: string
  mime?: string
  bytes?: number
}

interface VisualCacheEntry {
  visual?: StoredVisual
  rejected?: string[]
  failedUntil?: number
  touchedAt: number
}

interface OpenverseImage {
  id?: string
  title?: string
  thumbnail?: string
  url?: string
  creator?: string
  license?: string
  license_version?: string
  license_url?: string
  foreign_landing_url?: string
  mature?: boolean
  tags?: Array<{ name?: string }>
}

interface CommonsImageInfo {
  thumburl?: string
  url?: string
  descriptionurl?: string
  extmetadata?: Record<string, { value?: string }>
}

interface VisualCandidate extends Omit<StoredVisual, 'fileName' | 'mime' | 'bytes'> {
  imageUrl: string
  score: number
}

const CACHE_LIMIT_BYTES = 10 * 1024 * 1024
const CACHE_ENTRY_LIMIT = 5000
const CACHE_KEY_VERSION = 2
const NEGATIVE_CACHE_MS = 7 * 86_400_000
const MAX_IMAGE_BYTES = 1024 * 1024

/**
 * 小型高频概念映射。命中后取 Noto Emoji SVG（通常 2~8KB）；未命中再搜索开放图库。
 * 这里刻意只放含义稳定的词，避免把一词多义的抽象词错误映射成 Emoji。
 */
const EMOJI_BY_WORD: Record<string, string> = {
  apple: '🍎', banana: '🍌', orange: '🍊', lemon: '🍋', grape: '🍇', watermelon: '🍉',
  strawberry: '🍓', cherry: '🍒', peach: '🍑', pear: '🍐', pineapple: '🍍', avocado: '🥑',
  bread: '🍞', cheese: '🧀', egg: '🥚', rice: '🍚', pizza: '🍕', hamburger: '🍔', cake: '🍰',
  coffee: '☕', tea: '🍵', beer: '🍺', wine: '🍷', water: '💧',
  dog: '🐕', cat: '🐈', mouse: '🐁', rabbit: '🐇', fox: '🦊', bear: '🐻', panda: '🐼',
  lion: '🦁', tiger: '🐅', horse: '🐎', cow: '🐄', pig: '🐖', sheep: '🐑', monkey: '🐒',
  chicken: '🐔', duck: '🦆', bird: '🐦', eagle: '🦅', fish: '🐟', whale: '🐋', dolphin: '🐬',
  shark: '🦈', octopus: '🐙', butterfly: '🦋', bee: '🐝', ant: '🐜', spider: '🕷️',
  sun: '☀️', moon: '🌙', star: '⭐', cloud: '☁️', rain: '🌧️', snow: '❄️', fire: '🔥',
  tree: '🌳', flower: '🌸', leaf: '🍃', mountain: '⛰️', ocean: '🌊', earth: '🌍',
  house: '🏠', school: '🏫', hospital: '🏥', bank: '🏦', hotel: '🏨', church: '⛪', factory: '🏭',
  car: '🚗', bus: '🚌', train: '🚆', airplane: '✈️', bicycle: '🚲', motorcycle: '🏍️', ship: '🚢',
  phone: '📱', computer: '💻', keyboard: '⌨️', camera: '📷', television: '📺', radio: '📻',
  book: '📖', newspaper: '📰', pencil: '✏️', pen: '🖊️', scissors: '✂️', key: '🔑', lock: '🔒',
  clock: '🕐', watch: '⌚', calendar: '📅', money: '💰', gift: '🎁', balloon: '🎈',
  football: '⚽', basketball: '🏀', baseball: '⚾', tennis: '🎾', guitar: '🎸', piano: '🎹',
  doctor: '🧑‍⚕️', teacher: '🧑‍🏫', student: '🧑‍🎓', farmer: '🧑‍🌾', cook: '🧑‍🍳', police: '👮',
  baby: '👶', child: '🧒', man: '👨', woman: '👩', family: '👪', friend: '🧑‍🤝‍🧑',
  eye: '👁️', ear: '👂', nose: '👃', mouth: '👄', hand: '✋', foot: '🦶', heart: '❤️', brain: '🧠',
  happy: '😊', sad: '😢', angry: '😠', afraid: '😨', surprised: '😮', tired: '😴', sick: '🤒',
  run: '🏃', walk: '🚶', swim: '🏊', dance: '💃', sleep: '🛌', eat: '🍽️', drink: '🥤',
  write: '✍️', read: '📖', listen: '👂', speak: '🗣️', think: '🤔', laugh: '😂', cry: '😭'
}

const UNSAFE_RESULT = /\b(?:porn|porno|nude|nudity|naked|sex|sexual|blow\s*job|fetish|erotic|xxx)\b/i

function cleanText(value: string | undefined): string {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function sourceKey(v: Pick<StoredVisual, 'source' | 'id'>): string {
  return `${v.source}:${v.id}`
}

function senseKey(input: VocabVisualRequest): string {
  const raw = [CACHE_KEY_VERSION, input.text.trim().toLowerCase(), input.translation.trim(), input.sentence.trim()].join('|')
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32)
}

function notoId(emoji: string): string {
  return Array.from(emoji)
    .map((c) => c.codePointAt(0)!)
    .filter((cp) => cp !== 0xfe0f)
    .map((cp) => cp.toString(16))
    .join('_')
}

function dataUrl(bytes: Buffer, mime: string): string {
  return `data:${mime};base64,${bytes.toString('base64')}`
}

/** 独立于主数据的可重建图片缓存：图片总量按字节做 LRU，上限默认 10MB。 */
export class VocabVisuals {
  private entries = new Map<string, VisualCacheEntry>()
  private readonly inflight = new Map<string, Promise<VocabVisualResult | null>>()

  constructor(
    private readonly manifestFile: string,
    private readonly imageDir: string,
    private readonly fetchFn: FetchLike,
    private readonly maxBytes = CACHE_LIMIT_BYTES
  ) {
    this.load()
  }

  async get(
    input: VocabVisualRequest,
    queryFactory: () => Promise<string | null>,
    refresh = false
  ): Promise<VocabVisualResult | null> {
    const key = senseKey(input)
    if (!refresh) {
      const pending = this.inflight.get(key)
      if (pending) return pending
    }
    const task = this.resolve(key, input, queryFactory, refresh)
    if (!refresh) this.inflight.set(key, task)
    try {
      return await task
    } finally {
      if (!refresh) this.inflight.delete(key)
    }
  }

  private async resolve(
    key: string,
    input: VocabVisualRequest,
    queryFactory: () => Promise<string | null>,
    refresh: boolean
  ): Promise<VocabVisualResult | null> {
    let entry = this.entries.get(key)
    if (entry && !refresh) {
      const hit = this.readEntry(key, entry)
      if (hit) return hit
      if (entry.failedUntil && entry.failedUntil > Date.now()) return null
    }

    if (!entry) entry = { touchedAt: Date.now() }
    if (refresh && entry.visual) {
      entry.rejected = [...new Set([...(entry.rejected ?? []), sourceKey(entry.visual)])]
      this.removeFile(entry.visual)
      delete entry.visual
      delete entry.failedUntil
    }
    const rejected = new Set(entry.rejected ?? [])

    const word = input.text.trim().toLowerCase()
    const emoji = EMOJI_BY_WORD[word]
    if (emoji) {
      const id = notoId(emoji)
      if (!rejected.has(`noto:${id}`)) {
        const candidate: VisualCandidate = {
          source: 'noto',
          id,
          alt: input.text,
          emoji,
          creator: 'Google Noto Emoji',
          license: 'Apache 2.0',
          licenseUrl: 'https://www.apache.org/licenses/LICENSE-2.0',
          sourceUrl: 'https://github.com/googlefonts/noto-emoji',
          imageUrl: `https://raw.githubusercontent.com/googlefonts/noto-emoji/main/2D/svg/emoji_u${id}.svg`,
          score: 100
        }
        const stored = await this.download(key, candidate)
        // 网络异常时仍返回 Unicode Emoji，不让开源图标层拖累复习。
        entry.visual = stored ?? {
          source: candidate.source,
          id: candidate.id,
          alt: candidate.alt,
          emoji: candidate.emoji,
          creator: candidate.creator,
          license: candidate.license,
          licenseUrl: candidate.licenseUrl,
          sourceUrl: candidate.sourceUrl
        }
        entry.touchedAt = Date.now()
        this.entries.set(key, entry)
        this.flush()
        return this.readEntry(key, entry)
      }
    }

    const query = (await queryFactory())?.trim().slice(0, 120)
    if (query) {
      const tryCandidates = async (candidates: VisualCandidate[]): Promise<VocabVisualResult | null> => {
        const ordered = candidates
          .filter((candidate) => !rejected.has(sourceKey(candidate)))
          .sort((a, b) => b.score - a.score)
        for (const candidate of ordered) {
          const stored = await this.download(key, candidate)
          if (!stored) continue
          entry.visual = stored
          entry.touchedAt = Date.now()
          delete entry.failedUntil
          this.entries.set(key, entry)
          this.evict()
          this.flush()
          return this.readEntry(key, entry)
        }
        return null
      }
      const openverseResult = await tryCandidates(await this.searchOpenverse(query))
      if (openverseResult) return openverseResult
      const commonsResult = await tryCandidates(await this.searchCommons(query))
      if (commonsResult) return commonsResult
    }

    entry.failedUntil = Date.now() + NEGATIVE_CACHE_MS
    entry.touchedAt = Date.now()
    this.entries.set(key, entry)
    this.flush()
    return null
  }

  private readEntry(key: string, entry: VisualCacheEntry): VocabVisualResult | null {
    const visual = entry.visual
    if (!visual) return null
    entry.touchedAt = Date.now()
    this.entries.delete(key)
    this.entries.set(key, entry)
    if (!visual.fileName || !visual.mime) return { ...visual }
    try {
      const bytes = fs.readFileSync(path.join(this.imageDir, visual.fileName))
      return { ...visual, imageDataUrl: dataUrl(bytes, visual.mime) }
    } catch {
      this.removeFile(visual)
      delete entry.visual
      return null
    }
  }

  private async searchOpenverse(query: string): Promise<VisualCandidate[]> {
    const url = new URL('https://api.openverse.org/v1/images/')
    url.searchParams.set('q', query)
    url.searchParams.set('page_size', '12')
    url.searchParams.set('license', 'cc0,pdm,by')
    url.searchParams.set('license_type', 'commercial')
    url.searchParams.set('mature', 'false')
    try {
      const response = await this.fetchWithTimeout(url.toString())
      if (!response.ok) return []
      const body = (await response.json()) as { results?: OpenverseImage[] }
      const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2)
      return (body.results ?? []).flatMap((image, index) => {
        const title = cleanText(image.title)
        const tags = (image.tags ?? []).map((t) => cleanText(t.name)).join(' ')
        const haystack = `${title} ${tags}`.toLowerCase()
        const imageUrl = image.thumbnail || image.url
        if (!image.id || !imageUrl || image.mature || UNSAFE_RESULT.test(haystack)) return []
        const exactMatches = words.filter((w) => haystack.includes(w)).length
        return [{
          source: 'openverse' as const,
          id: image.id,
          alt: title || query,
          creator: cleanText(image.creator) || undefined,
          license: [image.license?.toUpperCase(), image.license_version].filter(Boolean).join(' '),
          licenseUrl: image.license_url,
          sourceUrl: image.foreign_landing_url,
          imageUrl,
          score: 60 - index + exactMatches * 12
        }]
      })
    } catch {
      return []
    }
  }

  private async searchCommons(query: string): Promise<VisualCandidate[]> {
    const url = new URL('https://commons.wikimedia.org/w/api.php')
    url.searchParams.set('action', 'query')
    url.searchParams.set('generator', 'search')
    url.searchParams.set('gsrsearch', query)
    url.searchParams.set('gsrnamespace', '6')
    url.searchParams.set('gsrlimit', '10')
    url.searchParams.set('prop', 'imageinfo')
    url.searchParams.set('iiprop', 'url|extmetadata')
    url.searchParams.set('iiurlwidth', '512')
    url.searchParams.set('format', 'json')
    url.searchParams.set('origin', '*')
    try {
      const response = await this.fetchWithTimeout(url.toString(), {
        headers: { 'Api-User-Agent': 'YTenSUB/0.1 (vocabulary visual aid)' }
      })
      if (!response.ok) return []
      const body = (await response.json()) as {
        query?: { pages?: Record<string, { pageid?: number; title?: string; imageinfo?: CommonsImageInfo[] }> }
      }
      const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2)
      return Object.values(body.query?.pages ?? {}).flatMap((page, index) => {
        const info = page.imageinfo?.[0]
        const meta = info?.extmetadata ?? {}
        const title = cleanText(page.title?.replace(/^File:/i, ''))
        const description = cleanText(meta.ImageDescription?.value)
        const haystack = `${title} ${description}`.toLowerCase()
        const license = cleanText(meta.LicenseShortName?.value)
        const imageUrl = info?.thumburl || info?.url
        if (!page.pageid || !imageUrl || UNSAFE_RESULT.test(haystack)) return []
        if (!/(?:public domain|cc0|cc by)/i.test(license)) return []
        const exactMatches = words.filter((w) => haystack.includes(w)).length
        return [{
          source: 'wikimedia' as const,
          id: String(page.pageid),
          alt: description || title || query,
          creator: cleanText(meta.Artist?.value) || undefined,
          license,
          licenseUrl: cleanText(meta.LicenseUrl?.value) || undefined,
          sourceUrl: info?.descriptionurl,
          imageUrl,
          score: 45 - index + exactMatches * 12
        }]
      })
    } catch {
      return []
    }
  }

  private async download(key: string, candidate: VisualCandidate): Promise<StoredVisual | null> {
    try {
      const response = await this.fetchWithTimeout(candidate.imageUrl)
      if (!response.ok) return null
      const declared = Number(response.headers.get('content-length') ?? 0)
      if (declared > MAX_IMAGE_BYTES) return null
      const bytes = Buffer.from(await response.arrayBuffer())
      if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null
      const mime = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
      const allowed = ['image/jpeg', 'image/png', 'image/webp'].includes(mime)
        || (candidate.source === 'noto' && mime === 'image/svg+xml')
      if (!allowed) return null
      fs.mkdirSync(this.imageDir, { recursive: true })
      const assetHash = crypto.createHash('sha256').update(candidate.imageUrl).digest('hex').slice(0, 16)
      const fileName = `${key}-${assetHash}.img`
      const target = path.join(this.imageDir, fileName)
      fs.writeFileSync(target + '.tmp', bytes)
      fs.renameSync(target + '.tmp', target)
      return {
        source: candidate.source,
        id: candidate.id,
        alt: candidate.alt,
        emoji: candidate.emoji,
        creator: candidate.creator,
        license: candidate.license,
        licenseUrl: candidate.licenseUrl,
        sourceUrl: candidate.sourceUrl,
        fileName,
        mime,
        bytes: bytes.length
      }
    } catch {
      return null
    }
  }

  private fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 12_000)
    timer.unref()
    return this.fetchFn(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer))
  }

  private removeFile(visual: StoredVisual): void {
    if (!visual.fileName) return
    try {
      fs.unlinkSync(path.join(this.imageDir, visual.fileName))
    } catch {
      // 缓存文件可能已被系统或用户清理。
    }
  }

  private evict(): void {
    let total = this.sizeBytes
    const oldest = [...this.entries.entries()].sort(([, a], [, b]) => a.touchedAt - b.touchedAt)
    for (const [key, entry] of oldest) {
      if (total <= this.maxBytes && this.entries.size <= CACHE_ENTRY_LIMIT) break
      if (entry.visual?.bytes) {
        total -= entry.visual.bytes
        this.removeFile(entry.visual)
      }
      this.entries.delete(key)
    }
  }

  clear(): void {
    for (const entry of this.entries.values()) {
      if (entry.visual) this.removeFile(entry.visual)
    }
    this.entries.clear()
    this.flush()
  }

  get sizeBytes(): number {
    let total = 0
    for (const entry of this.entries.values()) total += entry.visual?.bytes ?? 0
    return total
  }

  private load(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(this.manifestFile, 'utf8')) as Record<string, VisualCacheEntry>
      this.entries = new Map(
        Object.entries(raw)
          .filter(([, entry]) => entry && typeof entry.touchedAt === 'number')
          .sort(([, a], [, b]) => a.touchedAt - b.touchedAt)
      )
      this.evict()
    } catch {
      this.entries.clear()
    }
  }

  flush(): void {
    try {
      fs.mkdirSync(path.dirname(this.manifestFile), { recursive: true })
      const tmp = this.manifestFile + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.entries)), 'utf8')
      fs.renameSync(tmp, this.manifestFile)
    } catch (error) {
      console.error('[ytensub] 生词图片缓存落盘失败:', error)
    }
  }
}

export function isLikelyConcreteNoun(word: string, translation: string): boolean {
  const noun = /(?:^|[;；\s])n\./i.test(translation) || /名词/.test(translation)
  // 无 LLM 时宁可漏掉少数具体词，也不把博客里常见的抽象名词配成误导性照片。
  const abstractSuffix = /(?:tion|sion|ness|ity|ment|ance|ence|ship|hood|ism|dom|cy|th)$/i
  return noun && !abstractSuffix.test(word.trim())
}
