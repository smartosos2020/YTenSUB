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
  /** 复习等级（REVIEW_INTERVALS_MS 的下标）；undefined 表示从未复习 */
  reviewLevel?: number
  /** 下次复习到期时间戳 */
  reviewDue?: number
}

/** 复习间隔：等级 0~5 对应 10分钟/1天/3天/7天/15天/30天 */
export const REVIEW_INTERVALS_MS = [
  10 * 60_000,
  86_400_000,
  3 * 86_400_000,
  7 * 86_400_000,
  15 * 86_400_000,
  30 * 86_400_000
]

/** 达到该等级视为已掌握：字幕中不再橙色高亮 */
export const MASTERED_LEVEL = 5

export type TranslateSource = 'local' | 'google' | 'llm'

export interface TranslateResult {
  text: string
  translation: string
  phonetic?: string
  source: TranslateSource
}

/** 跟读脚本的一条句子（LLM 从字幕提炼、清洗口头禅） */
export interface ShadowingItem {
  /** 清洗后的英文句子（练习目标文本） */
  text: string
  /** 中文释义 */
  zh: string | null
  /** 对应原视频的起始秒（备用：将来原声切片/视频跳转） */
  start: number
  dur: number
}

/** 一个视频的跟读脚本：按 videoId 存储，生成一次终身复用 */
export interface ShadowingScript {
  videoId: string
  title: string
  generatedAt: number
  items: ShadowingItem[]
}

/** shadowing:generate 的返回：成功给脚本，失败给原因码 */
export type ShadowingResult =
  | { script: ShadowingScript }
  | { error: 'no-captions' | 'no-llm' | 'llm-failed' }

export type Theme = 'night' | 'day' | 'system'

/** 字幕浮层质感：纯色 / 毛玻璃 / 无边框纯文字 */
export type CaptionTexture = 'solid' | 'glass' | 'none'

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
  /** 界面主题：夜晚 / 白天 / 跟随系统 */
  theme: Theme
  /** 界面强调色 key（见 renderer theme.ts 的 ACCENTS 色板） */
  accentColor: string
  /** 是否显示中文字幕（默认关闭，由字幕列表顶部的滑动开关控制） */
  showZhSubtitle: boolean
  /** 主窗字幕（视频浮层）英文行字号 px，中文行按其 0.8 倍显示 */
  captionFontSize: number
  /** 主窗字幕字体 key（见 renderer caption-fonts.ts）；'default' 跟随界面等宽字体 */
  captionFont: string
  /** 字幕浮层质感：纯色 / 毛玻璃 / 无边框 */
  captionTexture: CaptionTexture
  /** 取词弹窗打开时自动朗读发音 */
  autoSpeakOnLookup: boolean
  /** 查词成功后自动加入生词本 */
  autoCollectWord: boolean
}

export interface AppData {
  folders: Folder[]
  favorites: Favorite[]
  vocab: VocabItem[]
  settings: Settings
  /** 跟读脚本，按 videoId 索引 */
  shadowing: Record<string, ShadowingScript>
}

export const DEFAULT_SETTINGS: Settings = {
  enabledTranslators: ['local', 'google'],
  llm: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini' },
  captionOpacity: 0.72,
  theme: 'night',
  accentColor: 'green',
  showZhSubtitle: false,
  captionFontSize: 20,
  captionFont: 'default',
  captionTexture: 'solid',
  autoSpeakOnLookup: false,
  autoCollectWord: false
}

export function defaultData(): AppData {
  return {
    folders: [],
    favorites: [],
    vocab: [],
    settings: DEFAULT_SETTINGS,
    shadowing: {}
  }
}
