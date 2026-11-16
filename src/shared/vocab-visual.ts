/** 复习卡片的轻量图片请求：不包含图片二进制，也不会写入生词主数据。 */
export interface VocabVisualRequest {
  text: string
  translation: string
  sentence: string
}

export type VocabVisualSource = 'noto' | 'openverse' | 'wikimedia'

/** 主进程解析并缓存后的图片结果。imageDataUrl 只在 IPC 返回时临时携带。 */
export interface VocabVisualResult {
  source: VocabVisualSource
  id: string
  alt: string
  imageDataUrl?: string
  /** Noto 下载失败时仍可用系统 Emoji 做零存储兜底。 */
  emoji?: string
  creator?: string
  license?: string
  licenseUrl?: string
  sourceUrl?: string
}
