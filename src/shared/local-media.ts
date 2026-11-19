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
  source: 'opensubtitles'
}

export interface DownloadedSubtitle extends LocalSubtitleFile {
  remaining?: number
}
