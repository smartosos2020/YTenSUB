export interface ResourceResult {
  id: string
  name: string
  magnet: string
  sourceUrl: string
  size: number
  seeders: number
  leechers: number
  added: number
}

export interface ResourceFile {
  index: number
  name: string
  size: number
  selected: boolean
  completed: boolean
}

export interface ResourcePreview {
  token: string
  name: string
  infoHash: string
  files: ResourceFile[]
}

export interface DownloadSettings {
  directory: string
  downloadLimitKB: number
  uploadLimitKB: number
  seedAfterDownload: boolean
}

export interface DownloadTask {
  id: string
  name: string
  directory: string
  state: 'initializing' | 'live' | 'paused' | 'error'
  finished: boolean
  /** Last verified completion; used only to retain the category during startup checks. */
  previouslyFinished?: boolean
  downloaded: number
  total: number
  uploaded: number
  downloadSpeed: number
  uploadSpeed: number
  peers: number
  discoveredPeers?: number
  failedPeers?: number
  connectingPeers?: number
  error?: string
  files: ResourceFile[]
}

export function isCompletedDownload(task: DownloadTask): boolean {
  return task.finished || (task.state === 'initializing' && task.previouslyFinished === true)
}

export interface DownloadSnapshot {
  settings: DownloadSettings
  tasks: DownloadTask[]
}
