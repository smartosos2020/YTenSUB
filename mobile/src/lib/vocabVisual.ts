import AsyncStorage from '@react-native-async-storage/async-storage'
import * as FileSystem from 'expo-file-system/legacy'
import { VocabItem } from './storage'

export interface MobileVocabVisual {
  source: 'noto' | 'openverse' | 'wikimedia'
  id: string
  uri?: string
  emoji?: string
  alt: string
  creator?: string
  license?: string
  sourceUrl?: string
}

interface CacheEntry extends MobileVocabVisual {
  fileName?: string
  bytes?: number
  touchedAt: number
  rejected?: string[]
  failedUntil?: number
}

const MANIFEST_KEY = 'ytensub:vocab-visual-cache-v1'
const CACHE_DIR = `${FileSystem.cacheDirectory ?? ''}vocab-visuals/`
const CACHE_LIMIT = 10 * 1024 * 1024
const CACHE_ENTRY_LIMIT = 5000
const CACHE_KEY_VERSION = 2
const NEGATIVE_CACHE_MS = 7 * 86_400_000

/** 移动端只内置含义较稳定、命中率高的常见概念；其余走开放图片搜索。 */
const EMOJI: Record<string, string> = {
  apple: '🍎', banana: '🍌', lemon: '🍋', grape: '🍇', watermelon: '🍉', strawberry: '🍓',
  pineapple: '🍍', bread: '🍞', cheese: '🧀', egg: '🥚', pizza: '🍕', coffee: '☕', tea: '🍵',
  dog: '🐕', cat: '🐈', rabbit: '🐇', panda: '🐼', lion: '🦁', tiger: '🐅', horse: '🐎',
  elephant: '🐘', giraffe: '🦒', dolphin: '🐬', shark: '🦈', butterfly: '🦋', spider: '🕷️',
  sun: '☀️', moon: '🌙', cloud: '☁️', rain: '🌧️', snow: '❄️', tree: '🌳', flower: '🌸',
  mountain: '⛰️', ocean: '🌊', house: '🏠', school: '🏫', hospital: '🏥', factory: '🏭',
  car: '🚗', bus: '🚌', train: '🚆', airplane: '✈️', bicycle: '🚲', ship: '🚢',
  phone: '📱', computer: '💻', camera: '📷', television: '📺', book: '📖', pencil: '✏️',
  clock: '🕐', calendar: '📅', football: '⚽', basketball: '🏀', guitar: '🎸', piano: '🎹',
  doctor: '🧑‍⚕️', teacher: '🧑‍🏫', farmer: '🧑‍🌾', baby: '👶', family: '👪',
  eye: '👁️', ear: '👂', nose: '👃', brain: '🧠'
}

const UNSAFE = /\b(?:porn|porno|nude|nudity|naked|sex|sexual|blow\s*job|fetish|erotic|xxx)\b/i
let manifestPromise: Promise<Record<string, CacheEntry>> | null = null

function hash(text: string): string {
  let value = 2166136261
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i)
    value = Math.imul(value, 16777619)
  }
  return (value >>> 0).toString(16).padStart(8, '0')
}

function keyFor(item: Pick<VocabItem, 'text' | 'translation' | 'sentence'>): string {
  return hash(`${CACHE_KEY_VERSION}|${item.text.trim().toLowerCase()}|${item.translation.trim()}|${item.sentence.trim()}`)
}

function notoId(emoji: string): string {
  return Array.from(emoji)
    .map((char) => char.codePointAt(0)!)
    .filter((code) => code !== 0xfe0f)
    .map((code) => code.toString(16))
    .join('_')
}

async function loadManifest(): Promise<Record<string, CacheEntry>> {
  if (!manifestPromise) {
    manifestPromise = AsyncStorage.getItem(MANIFEST_KEY).then((raw) => {
      try {
        return raw ? JSON.parse(raw) : {}
      } catch {
        return {}
      }
    })
  }
  return manifestPromise
}

async function saveManifest(manifest: Record<string, CacheEntry>): Promise<void> {
  await AsyncStorage.setItem(MANIFEST_KEY, JSON.stringify(manifest))
}

async function removeFile(entry: CacheEntry): Promise<void> {
  if (!entry.fileName || !CACHE_DIR) return
  await FileSystem.deleteAsync(`${CACHE_DIR}${entry.fileName}`, { idempotent: true }).catch(() => {})
}

async function enforceLimit(manifest: Record<string, CacheEntry>): Promise<void> {
  let total = Object.values(manifest).reduce((sum, entry) => sum + (entry.bytes ?? 0), 0)
  const oldest = Object.entries(manifest).sort(([, a], [, b]) => a.touchedAt - b.touchedAt)
  for (const [key, entry] of oldest) {
    if (total <= CACHE_LIMIT && Object.keys(manifest).length <= CACHE_ENTRY_LIMIT) break
    if (entry.bytes) {
      total -= entry.bytes
      await removeFile(entry)
    }
    delete manifest[key]
  }
}

async function download(url: string, key: string): Promise<{ uri: string; fileName: string; bytes: number } | null> {
  if (!CACHE_DIR) return null
  try {
    await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true })
    const fileName = `${key}-${hash(url)}.img`
    const uri = `${CACHE_DIR}${fileName}`
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {})
    const result = await FileSystem.downloadAsync(url, uri)
    if (result.status < 200 || result.status >= 300) {
      await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {})
      return null
    }
    const mime = String(result.mimeType || result.headers['content-type'] || '')
      .split(';')[0]
      .trim()
      .toLowerCase()
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
      await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {})
      return null
    }
    const info = await FileSystem.getInfoAsync(uri)
    const bytes = info.exists && typeof info.size === 'number' ? info.size : 0
    if (bytes <= 0 || bytes > 1024 * 1024) {
      await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {})
      return null
    }
    return { uri, fileName, bytes }
  } catch {
    return null
  }
}

async function searchOpenverse(query: string): Promise<Array<MobileVocabVisual & { imageUrl: string }>> {
  try {
    const params = new URLSearchParams({
      q: query,
      page_size: '12',
      license: 'cc0,pdm,by',
      license_type: 'commercial',
      mature: 'false'
    })
    const response = await fetch(`https://api.openverse.org/v1/images/?${params}`)
    if (!response.ok) return []
    const body = await response.json() as {
      results?: Array<{
        id?: string; title?: string; thumbnail?: string; url?: string; creator?: string
        license?: string; license_version?: string; foreign_landing_url?: string; mature?: boolean
        tags?: Array<{ name?: string }>
      }>
    }
    return (body.results ?? []).flatMap((image) => {
      const title = String(image.title ?? '').trim()
      const tags = (image.tags ?? []).map((tag) => tag.name ?? '').join(' ')
      const imageUrl = image.thumbnail || image.url
      if (!image.id || !imageUrl || image.mature || UNSAFE.test(`${title} ${tags}`)) return []
      return [{
        source: 'openverse' as const,
        id: image.id,
        alt: title || query,
        creator: image.creator,
        license: [image.license?.toUpperCase(), image.license_version].filter(Boolean).join(' '),
        sourceUrl: image.foreign_landing_url,
        imageUrl
      }]
    })
  } catch {
    return []
  }
}

async function searchCommons(query: string): Promise<Array<MobileVocabVisual & { imageUrl: string }>> {
  try {
    const params = new URLSearchParams({
      action: 'query', generator: 'search', gsrsearch: query, gsrnamespace: '6', gsrlimit: '10',
      prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '512', format: 'json', origin: '*'
    })
    const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
      headers: { 'Api-User-Agent': 'YTenSUB/0.1 (vocabulary visual aid)' }
    })
    if (!response.ok) return []
    const body = await response.json() as {
      query?: { pages?: Record<string, {
        pageid?: number; title?: string; imageinfo?: Array<{
          thumburl?: string; url?: string; descriptionurl?: string
          extmetadata?: Record<string, { value?: string }>
        }>
      }> }
    }
    return Object.values(body.query?.pages ?? {}).flatMap((page) => {
      const info = page.imageinfo?.[0]
      const meta = info?.extmetadata ?? {}
      const imageUrl = info?.thumburl || info?.url
      const license = String(meta.LicenseShortName?.value ?? '').replace(/<[^>]*>/g, '').trim()
      const title = String(page.title ?? '').replace(/^File:/i, '').trim()
      if (!page.pageid || !imageUrl || !/(?:public domain|cc0|cc by)/i.test(license) || UNSAFE.test(title)) return []
      return [{
        source: 'wikimedia' as const,
        id: String(page.pageid),
        alt: title || query,
        creator: String(meta.Artist?.value ?? '').replace(/<[^>]*>/g, '').trim() || undefined,
        license,
        sourceUrl: info?.descriptionurl,
        imageUrl
      }]
    })
  } catch {
    return []
  }
}

function publicResult(entry: CacheEntry): MobileVocabVisual {
  return {
    source: entry.source,
    id: entry.id,
    uri: entry.uri,
    emoji: entry.emoji,
    alt: entry.alt,
    creator: entry.creator,
    license: entry.license,
    sourceUrl: entry.sourceUrl
  }
}

/** 图片缓存不进入生词 AsyncStorage；缓存目录可被系统回收，丢失后会自动重建。 */
export async function vocabVisualGet(
  item: Pick<VocabItem, 'text' | 'translation' | 'sentence'>,
  refresh = false
): Promise<MobileVocabVisual | null> {
  const manifest = await loadManifest()
  const key = keyFor(item)
  let current: CacheEntry | undefined = manifest[key]
  if (current && !refresh) {
    if (current.fileName) {
      const info = await FileSystem.getInfoAsync(`${CACHE_DIR}${current.fileName}`).catch(() => null)
      if (info?.exists) {
        current.touchedAt = Date.now()
        current.uri = `${CACHE_DIR}${current.fileName}`
        void saveManifest(manifest)
        return publicResult(current)
      }
      delete manifest[key]
      current = undefined
    } else if (current.emoji) {
      current.touchedAt = Date.now()
      return publicResult(current)
    } else if (current.failedUntil && current.failedUntil > Date.now()) {
      return null
    }
  }

  const rejected = new Set(current?.rejected ?? [])
  if (refresh && current) {
    rejected.add(`${current.source}:${current.id}`)
    await removeFile(current)
  }

  const word = item.text.trim().toLowerCase()
  const emoji = EMOJI[word]
  if (emoji) {
    const id = notoId(emoji)
    if (!rejected.has(`noto:${id}`)) {
      const url = `https://raw.githubusercontent.com/googlefonts/noto-emoji/main/2D/png/128/emoji_u${id}.png`
      const file = await download(url, key)
      const entry: CacheEntry = {
        source: 'noto', id, alt: item.text, emoji,
        uri: file?.uri, fileName: file?.fileName, bytes: file?.bytes,
        creator: 'Google Noto Emoji', license: 'Apache 2.0',
        sourceUrl: 'https://github.com/googlefonts/noto-emoji',
        rejected: [...rejected], touchedAt: Date.now()
      }
      manifest[key] = entry
      await enforceLimit(manifest)
      await saveManifest(manifest)
      return publicResult(entry)
    }
  }

  const noun = /(?:^|[;；\s])n\./i.test(item.translation) || /名词/.test(item.translation)
  const abstractSuffix = /(?:tion|sion|ness|ity|ment|ance|ence|ship|hood|ism|dom|cy|th)$/i
  const imageable = noun && !abstractSuffix.test(word)
  if (imageable) {
    const openverse = await searchOpenverse(word)
    for (let pass = 0; pass < 2; pass++) {
      const candidates = pass === 0 ? openverse : await searchCommons(word)
      for (const candidate of candidates) {
        if (rejected.has(`${candidate.source}:${candidate.id}`)) continue
        const file = await download(candidate.imageUrl, key)
        if (!file) continue
        const entry: CacheEntry = {
          source: candidate.source,
          id: candidate.id,
          alt: candidate.alt,
          creator: candidate.creator,
          license: candidate.license,
          sourceUrl: candidate.sourceUrl,
          uri: file.uri,
          fileName: file.fileName,
          bytes: file.bytes,
          rejected: [...rejected],
          touchedAt: Date.now()
        }
        manifest[key] = entry
        await enforceLimit(manifest)
        await saveManifest(manifest)
        return publicResult(entry)
      }
    }
  }

  manifest[key] = {
    source: 'openverse', id: 'none', alt: item.text,
    rejected: [...rejected], failedUntil: Date.now() + NEGATIVE_CACHE_MS, touchedAt: Date.now()
  }
  await enforceLimit(manifest)
  await saveManifest(manifest)
  return null
}
