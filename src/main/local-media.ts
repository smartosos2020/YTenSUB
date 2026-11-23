import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { parseExternalSubtitle } from '../shared/captions'
import type {
  DownloadedSubtitle,
  LocalSubtitleFile,
  LocalVideoFile,
  LocalVideoFolder,
  OnlineSubtitleCandidate
} from '../shared/local-media'

const HASH_CHUNK = 64 * 1024
const UINT64_MASK = (1n << 64n) - 1n
export const LOCAL_VIDEO_EXTENSIONS = ['mp4', 'm4v', 'webm', 'mov', 'mkv', 'avi']

export async function readLocalVideoFolder(folderPath: string): Promise<LocalVideoFolder> {
  const folder: LocalVideoFolder = {
    path: folderPath,
    name: path.basename(folderPath) || folderPath,
    videos: []
  }
  try {
    const entries = await fs.promises.readdir(folderPath, { withFileTypes: true })
    folder.videos = entries
      .filter((entry) => entry.isFile() && LOCAL_VIDEO_EXTENSIONS.includes(path.extname(entry.name).slice(1).toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }))
      .map((entry) => ({ name: entry.name, path: path.join(folderPath, entry.name) }))
  } catch {
    folder.error = '无法读取文件夹，请检查路径或设备连接'
  }
  return folder
}

/** Opening a file is the only point where the playlist reads video bytes. */
export async function readLocalVideo(filePath: string): Promise<LocalVideoFile> {
  const resolvedPath = path.resolve(filePath)
  const stat = await fs.promises.stat(resolvedPath)
  if (!stat.isFile()) throw new Error('所选路径不是视频文件')
  return {
    path: resolvedPath,
    url: `ytensub-media://video?path=${encodeURIComponent(resolvedPath)}`,
    name: path.basename(resolvedPath),
    extension: path.extname(resolvedPath).slice(1).toLowerCase(),
    size: stat.size,
    hash: await computeOpenSubtitlesHash(resolvedPath).catch(() => null),
    ...parseEpisodeInfo(path.basename(resolvedPath)),
    sidecarSubtitle: findSidecarSubtitle(resolvedPath)
  }
}

export async function resolvePlaylistVideo(filePath: string, folderPaths: string[]): Promise<string> {
  if (typeof filePath !== 'string') throw new Error('视频路径无效')
  const resolvedPath = await fs.promises.realpath(filePath)
  if (!folderPaths.includes(path.dirname(resolvedPath)) ||
      !LOCAL_VIDEO_EXTENSIONS.includes(path.extname(resolvedPath).slice(1).toLowerCase())) {
    throw new Error('请先将视频所在文件夹添加到播放列表')
  }
  return resolvedPath
}

export interface EpisodeInfo {
  query: string
  season?: number
  episode?: number
}

/** 从常见美剧文件名提取剧名与 SxxEyy / 1x02 季集信息。 */
export function parseEpisodeInfo(fileName: string): EpisodeInfo {
  const stem = path.basename(fileName, path.extname(fileName))
  const seasonEpisode = /(?:^|[. _-])S(\d{1,2})E(\d{1,3})(?:[. _-]|$)/i.exec(stem)
  const alt = seasonEpisode ? null : /(?:^|[. _-])(\d{1,2})x(\d{1,3})(?:[. _-]|$)/i.exec(stem)
  const hit = seasonEpisode ?? alt
  const titlePart = hit ? stem.slice(0, hit.index) : stem
  const query = titlePart
    .replace(/[._]+/g, ' ')
    .replace(/\b(?:19|20)\d{2}\b.*$/i, '')
    .replace(/\b(?:2160p|1080p|720p|480p|web[ ._-]?dl|webrip|bluray|hdtv|x26[45]|h26[45]|hevc|av1)\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  return {
    query: query || stem.replace(/[._]+/g, ' ').trim(),
    ...(hit ? { season: Number(hit[1]), episode: Number(hit[2]) } : {})
  }
}

export function computeHashFromParts(size: bigint, head: Buffer, tail: Buffer): string {
  let hash = size & UINT64_MASK
  for (const chunk of [head, tail]) {
    for (let offset = 0; offset + 8 <= chunk.length; offset += 8) {
      hash = (hash + chunk.readBigUInt64LE(offset)) & UINT64_MASK
    }
  }
  return hash.toString(16).padStart(16, '0')
}

export interface MediaByteRange {
  start: number
  end: number
}

/** Parse a single HTTP byte range. undefined = no range; null = invalid range. */
export function parseMediaByteRange(
  header: string | null,
  size: number
): MediaByteRange | undefined | null {
  if (!header) return undefined
  if (!Number.isSafeInteger(size) || size <= 0) return null
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim())
  if (!match || (!match[1] && !match[2])) return null

  if (!match[1]) {
    const suffixLength = Number(match[2])
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null
    return { start: Math.max(0, size - suffixLength), end: size - 1 }
  }

  const start = Number(match[1])
  const requestedEnd = match[2] ? Number(match[2]) : size - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd)) return null
  if (start < 0 || start >= size || requestedEnd < start) return null
  return { start, end: Math.min(requestedEnd, size - 1) }
}

/** OpenSubtitles OSHash：只读取视频头尾各 64KB。 */
export async function computeOpenSubtitlesHash(filePath: string): Promise<string | null> {
  const handle = await fs.promises.open(filePath, 'r')
  try {
    const stat = await handle.stat()
    if (stat.size < HASH_CHUNK * 2) return null
    const head = Buffer.alloc(HASH_CHUNK)
    const tail = Buffer.alloc(HASH_CHUNK)
    await handle.read(head, 0, HASH_CHUNK, 0)
    await handle.read(tail, 0, HASH_CHUNK, stat.size - HASH_CHUNK)
    return computeHashFromParts(BigInt(stat.size), head, tail)
  } finally {
    await handle.close()
  }
}

export function decodeSubtitleBuffer(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString('utf16le')
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.subarray(2))
    swapped.swap16()
    return swapped.toString('utf16le')
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return new TextDecoder('windows-1252').decode(buffer)
  }
}

export function findSidecarSubtitle(videoPath: string): LocalSubtitleFile | undefined {
  const dir = path.dirname(videoPath)
  const stem = path.basename(videoPath, path.extname(videoPath))
  const candidates = [
    `${stem}.en.srt`, `${stem}.eng.srt`, `${stem}.srt`,
    `${stem}.en.vtt`, `${stem}.vtt`, `${stem}.en.ass`, `${stem}.ass`,
    `${stem}.en.ssa`, `${stem}.ssa`
  ]

  // A downloaded selection takes precedence when the video is opened again.
  const downloadDir = path.join(dir, 'dSub')
  const downloaded = candidates.flatMap((fileName) => {
    try {
      const filePath = path.join(downloadDir, fileName)
      const stat = fs.statSync(filePath)
      return stat.isFile() && stat.size <= 8 * 1024 * 1024
        ? [{ fileName, filePath, modified: stat.mtimeMs }]
        : []
    } catch {
      return []
    }
  }).sort((a, b) => b.modified - a.modified)
  for (const candidate of downloaded) {
    try {
      return { fileName: candidate.fileName, text: decodeSubtitleBuffer(fs.readFileSync(candidate.filePath)) }
    } catch {
      // Continue with another saved subtitle if a file is unreadable.
    }
  }

  // Prefer a sidecar beside the video, then inspect common subtitle folders and
  // other descendants. Depth and directory count are bounded so opening a video
  // cannot accidentally walk a very large media library.
  const directories: string[] = [dir]
  const queue: Array<{ dir: string; depth: number }> = [{ dir, depth: 0 }]
  const maxDepth = 2
  const maxDirectories = 128
  while (queue.length && directories.length < maxDirectories) {
    const current = queue.shift()
    if (!current || current.depth >= maxDepth) continue
    let children: fs.Dirent[]
    try {
      children = fs.readdirSync(current.dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .sort((a, b) => {
          const preferred = /^(?:subs?|subtitles?|captions?)$/i
          return Number(preferred.test(b.name)) - Number(preferred.test(a.name))
            || a.name.localeCompare(b.name)
        })
    } catch {
      continue
    }
    for (const child of children) {
      if (directories.length >= maxDirectories) break
      const childDir = path.join(current.dir, child.name)
      directories.push(childDir)
      queue.push({ dir: childDir, depth: current.depth + 1 })
    }
  }

  for (const searchDir of directories) {
    for (const fileName of candidates) {
      const filePath = path.join(searchDir, fileName)
      try {
        const stat = fs.statSync(filePath)
        if (!stat.isFile() || stat.size > 8 * 1024 * 1024) continue
        return { fileName, text: decodeSubtitleBuffer(fs.readFileSync(filePath)) }
      } catch {
        // Continue looking for the next sidecar candidate.
      }
    }
  }
  return undefined
}

/** Save one selected subtitle per format, with a name the sidecar lookup can find. */
export async function saveDownloadedSubtitle(
  videoPath: string,
  subtitle: LocalSubtitleFile
): Promise<string> {
  if (!parseExternalSubtitle(subtitle.text).length) throw new Error('无法解析下载的字幕')
  const extension = path.extname(subtitle.fileName).toLowerCase()
  const subtitleExtension = ['.srt', '.vtt', '.ass', '.ssa'].includes(extension) ? extension : '.srt'
  const stem = path.basename(videoPath, path.extname(videoPath))
  const directory = path.join(path.dirname(videoPath), 'dSub')
  const savedPath = path.join(directory, `${stem}.en${subtitleExtension}`)
  await fs.promises.mkdir(directory, { recursive: true })
  const temporaryPath = `${savedPath}.${randomUUID()}.tmp`
  try {
    await fs.promises.writeFile(temporaryPath, subtitle.text, { encoding: 'utf8', flag: 'wx' })
    await fs.promises.rename(temporaryPath, savedPath)
  } finally {
    await fs.promises.rm(temporaryPath, { force: true })
  }
  return savedPath
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

/**
 * Electron net.fetch may occasionally leave a CDN request pending even after its
 * AbortSignal fires. Race it with our own deadline so the renderer is always
 * released from the loading state; abort remains useful for closing the socket.
 */
export async function fetchWithDeadline(
  fetchFn: FetchFn,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  timeoutMessage: string
): Promise<Response> {
  const controller = new AbortController()
  let timedOut = false
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true
      reject(new Error(timeoutMessage))
      controller.abort()
    }, timeoutMs)
  })
  try {
    return await Promise.race([
      fetchFn(url, { ...init, signal: controller.signal }),
      deadline
    ])
  } catch (error) {
    if (timedOut) throw new Error(timeoutMessage, { cause: error })
    throw error
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}

interface OsFile { file_id?: number; file_name?: string }
interface OsAttributes {
  language?: string
  download_count?: number
  hearing_impaired?: boolean
  fps?: number
  release?: string
  moviehash_match?: boolean
  files?: OsFile[]
  feature_details?: { season_number?: number; episode_number?: number; movie_name?: string }
}
interface OsRow { id?: string; attributes?: OsAttributes }

function releaseTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 2 && !['the', 'and', 'eng', 'english'].includes(token))
  )
}

function scoreCandidate(
  attrs: OsAttributes,
  fileName: string,
  localName: string,
  season?: number,
  episode?: number
): { score: number; matchReasons: string[] } {
  let score = attrs.moviehash_match ? 1000 : 0
  const matchReasons: string[] = []
  if (attrs.moviehash_match) matchReasons.push('文件 Hash 精确匹配')
  const details = attrs.feature_details
  if (season !== undefined && details?.season_number === season) {
    score += 120
    matchReasons.push('季数一致')
  }
  if (episode !== undefined && details?.episode_number === episode) {
    score += 160
    matchReasons.push('集数一致')
  }
  const local = releaseTokens(localName)
  const remote = releaseTokens(`${attrs.release ?? ''} ${fileName}`)
  const matchingTokens = [...local].filter((token) => remote.has(token))
  score += Math.min(120, matchingTokens.length * 12)
  if (matchingTokens.length) {
    matchReasons.push(`文件名相同标记 ${matchingTokens.slice(0, 4).join('、')}`)
  }
  score += Math.min(40, Math.log10(Math.max(1, attrs.download_count ?? 0)) * 10)
  if (attrs.hearing_impaired) score -= 5
  if (!matchReasons.length) matchReasons.push('参考下载量')
  return { score: Math.round(score), matchReasons }
}

export async function searchOpenSubtitles(options: {
  apiKey: string
  hash: string | null
  query: string
  fileName: string
  season?: number
  episode?: number
  userAgent: string
  fetchFn: FetchFn
}): Promise<OnlineSubtitleCandidate[]> {
  const { apiKey, hash, query, fileName, season, episode, userAgent, fetchFn } = options
  const searches: URLSearchParams[] = []
  if (hash) searches.push(new URLSearchParams({ languages: 'en', moviehash: hash }))
  if (query) {
    const params = new URLSearchParams({ languages: 'en', query })
    if (season !== undefined) params.set('season_number', String(season))
    if (episode !== undefined) params.set('episode_number', String(episode))
    searches.push(params)
  }
  const rows = (
    await Promise.all(
      searches.map(async (params) => {
        const response = await fetchWithDeadline(
          fetchFn,
          `https://api.opensubtitles.com/api/v1/subtitles?${params}`,
          { headers: { 'Api-Key': apiKey, 'User-Agent': userAgent, Accept: 'application/json' } },
          15_000,
          'OpenSubtitles 搜索超时，请检查网络或代理'
        )
        if (!response.ok) throw new Error(`OpenSubtitles 搜索失败：HTTP ${response.status}`)
        const json = (await response.json()) as { data?: OsRow[] }
        return json.data ?? []
      })
    )
  ).flat()

  const byFile = new Map<number, OnlineSubtitleCandidate>()
  for (const row of rows) {
    const attrs = row.attributes ?? {}
    for (const file of attrs.files ?? []) {
      if (!file.file_id) continue
      const candidate: OnlineSubtitleCandidate = {
        id: `${row.id ?? 'subtitle'}:${file.file_id}`,
        fileId: file.file_id,
        fileName: file.file_name ?? `subtitle-${file.file_id}.srt`,
        release: attrs.release ?? attrs.feature_details?.movie_name ?? '',
        language: attrs.language ?? 'en',
        downloads: attrs.download_count ?? 0,
        hearingImpaired: attrs.hearing_impaired === true,
        fps: Number.isFinite(attrs.fps) ? Number(attrs.fps) : null,
        exactMatch: attrs.moviehash_match === true,
        ...scoreCandidate(attrs, file.file_name ?? '', fileName, season, episode),
        source: 'opensubtitles'
      }
      const previous = byFile.get(candidate.fileId)
      if (!previous || candidate.score > previous.score) byFile.set(candidate.fileId, candidate)
    }
  }
  return [...byFile.values()].sort((a, b) => b.score - a.score || b.downloads - a.downloads).slice(0, 12)
}

export async function downloadOpenSubtitle(options: {
  apiKey: string
  fileId: number
  userAgent: string
  fetchFn: FetchFn
}): Promise<DownloadedSubtitle> {
  const response = await fetchWithDeadline(
    options.fetchFn,
    'https://api.opensubtitles.com/api/v1/download',
    {
      method: 'POST',
      headers: {
        'Api-Key': options.apiKey,
        'User-Agent': options.userAgent,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ file_id: options.fileId })
    },
    15_000,
    'OpenSubtitles 下载请求超时，请稍后重试'
  )
  if (!response.ok) throw new Error(`OpenSubtitles 下载请求失败：HTTP ${response.status}`)
  const json = (await response.json()) as { link?: string; file_name?: string; remaining?: number }
  if (!json.link) throw new Error('OpenSubtitles 没有返回下载地址')
  // The temporary link is served by OpenSubtitles' CDN, not the API. Let Electron
  // use its normal browser User-Agent here; reusing the API client User-Agent can
  // make Cloudflare keep the download connection open without returning a body.
  const fileResponse = await fetchWithDeadline(
    options.fetchFn,
    json.link,
    {},
    30_000,
    '字幕文件下载超时，请稍后重试'
  )
  if (!fileResponse.ok) throw new Error(`字幕下载失败：HTTP ${fileResponse.status}`)
  let buffer = Buffer.from(await fileResponse.arrayBuffer())
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) buffer = gunzipSync(buffer)
  if (buffer.length > 8 * 1024 * 1024) throw new Error('字幕文件过大，已拒绝加载')
  return {
    fileName: json.file_name ?? `subtitle-${options.fileId}.srt`,
    text: decodeSubtitleBuffer(buffer),
    remaining: json.remaining
  }
}
