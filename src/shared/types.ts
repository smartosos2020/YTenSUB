export interface Folder {
  id: string
  name: string
}

export interface Favorite {
  videoId: string
  title: string
  channel: string
  thumbnail: string
  folderId: string | null
  addedAt: number
}

export interface VocabItem {
  id: string
  text: string
  translation: string
  phonetic?: string
  videoId: string
  videoTitle: string
  timestamp: number
  sentence: string
  addedAt: number
}

export type TranslateSource = 'local' | 'google' | 'llm'

export interface TranslateResult {
  text: string
  translation: string
  phonetic?: string
  source: TranslateSource
}

export type Theme = 'night' | 'day'

export interface LlmSettings {
  baseUrl: string
  apiKey: string
  model: string
}

export interface Settings {
  /** 翻译链按固定优先级 local → google → llm 执行，这里只控制各级的开关 */
  enabledTranslators: TranslateSource[]
  llm: LlmSettings
  /** 视频字幕浮层背景透明度 0.2 ~ 1 */
  captionOpacity: number
  /** 界面主题：夜晚（深色底灰白字）/ 白天（浅色底黑字） */
  theme: Theme
  /** 是否显示中文字幕（默认关闭，由字幕列表顶部的滑动开关控制） */
  showZhSubtitle: boolean
  /** 主窗字幕（视频浮层）英文行字号 px，中文行按其 0.8 倍显示 */
  captionFontSize: number
  /** 主窗字幕字体 key（见 renderer caption-fonts.ts）；'default' 跟随界面等宽字体 */
  captionFont: string
}

export interface AppData {
  folders: Folder[]
  favorites: Favorite[]
  vocab: VocabItem[]
  settings: Settings
}

export const DEFAULT_SETTINGS: Settings = {
  enabledTranslators: ['local', 'google'],
  llm: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini' },
  captionOpacity: 0.72,
  theme: 'night',
  showZhSubtitle: false,
  captionFontSize: 20,
  captionFont: 'default'
}

export function defaultData(): AppData {
  return {
    folders: [],
    favorites: [],
    vocab: [],
    settings: DEFAULT_SETTINGS
  }
}
