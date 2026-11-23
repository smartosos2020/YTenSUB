export interface LocalSubtitleFile {
  fileName: string
  text: string
}

export interface LocalVideoFile {
  path: string
  url: string
  name: string
  extension: string
  size: number
  hash: string | null
  query: string
  season?: number
  episode?: number
  sidecarSubtitle?: LocalSubtitleFile
}

export interface LocalPlaylistVideo {
  path: string
  name: string
}

export interface LocalVideoFolder {
  path: string
  name: string
  videos: LocalPlaylistVideo[]
  error?: string
}

export interface OnlineSubtitleCandidate {
  id: string
  fileId: number
  fileName: string
  release: string
  language: string
  downloads: number
  hearingImpaired: boolean
  fps: number | null
  exactMatch: boolean
  score: number
  matchReasons: string[]
  source: 'opensubtitles'
}

export interface DownloadedSubtitle extends LocalSubtitleFile {
  remaining?: number
  savedPath?: string
  saveError?: string
}
