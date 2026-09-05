export interface Folder {
  id: string
  name: string
}

/** CEFR 难度等级 */
export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2'

export const CEFR_LEVELS: CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']

/** 收藏视频内容类型预设标签（用户可自定义，自定义的不进此列表） */
export const FAV_TAG_PRESETS = ['生活', '科技', '商业', '教育', '娱乐', '新闻', '访谈', '教程']

/** YouTube 官方分类 → 预设标签（免费基线：不需要 LLM 也能自动打标签） */
const YT_CATEGORY_TAG: Record<string, string> = {
  Education: '教育',
  'Howto & Style': '教程',
  'Science & Technology': '科技',
  'News & Politics': '新闻',
  Entertainment: '娱乐',
  Comedy: '娱乐',
  'Film & Animation': '娱乐',
  Gaming: '娱乐',
  Music: '娱乐',
  Sports: '生活',
  'People & Blogs': '生活',
  'Travel & Events': '生活',
  'Pets & Animals': '生活',
  'Autos & Vehicles': '生活',
  'Nonprofits & Activism': '商业'
}

/** YouTube 分类映射到预设标签；映射不上返回 null（留给 LLM） */
export function mapYtCategoryToTag(category?: string): string | null {
  if (!category) return null
  return YT_CATEGORY_TAG[category] ?? null
}

export interface Favorite {
  videoId: string
  title: string
  channel: string
  thumbnail: string
  folderId: string | null
  addedAt: number
  /** CEFR 难度；null/undefined = 未评估 */
  level?: CefrLevel | null
  /** level 是否为自动估值（true=词频/LLM 估的，手动改后变 false 不再被自动覆盖） */
  levelAuto?: boolean
  /** 内容类型标签（多选，"或"筛选） */
  tags?: string[]
  /** 时长（秒）；老数据没有则不显示 */
  duration?: number
  /** 创作者头像 URL；老数据没有则显示首字母圆 */
  avatar?: string
  /** YouTube 官方分类（如 Education）；用于自动打标签的免费基线 */
  ytCategory?: string
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
  /** 场景号：连续句子同属一个场景，保持视频的叙事延续性 */
  scene?: number
}

/** 一个视频的跟读脚本：按 videoId 存储，生成一次终身复用 */
export interface ShadowingScript {
  videoId: string
  title: string
  generatedAt: number
  /** 生成方式（老数据可能缺失） */
  generatedBy?: 'llm' | 'rules' | 'raw'
  /** LLM 调用失败的原因（规则兜底产物上记录，便于诊断） */
  llmError?: string
  items: ShadowingItem[]
}

/** shadowing:generate 的返回：成功给脚本，失败给原因码（detail 为具体错误） */
export type ShadowingResult =
  | { script: ShadowingScript }
  | { error: 'no-captions' | 'no-llm' | 'llm-failed'; detail?: string }

/** 跟读脚本生成策略：仅 LLM / LLM 优先本地规则兜底 / 仅本地规则（免费，质量较低） / 直接使用字幕 */
export type ShadowingStrategy = 'llm-only' | 'llm-fallback' | 'rules-only' | 'raw'

export type Theme = 'night' | 'day' | 'system'

/** 字幕浮层质感：纯色 / 毛玻璃 / 无边框纯文字 */
export type CaptionTexture = 'solid' | 'glass' | 'none'

export interface LlmSettings {
  baseUrl: string
  apiKey: string
  model: string
}

export interface Settings {
  /** 翻译链：数组顺序即优先级，依次回退 */
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
  /** 是否显示视频区字幕浮层（侧栏底部开关，默认开） */
  showCaptions: boolean
  /** 主窗字幕（视频浮层）英文行字号 px */
  captionFontSize: number
  /** 主窗字幕中文行字号 px */
  captionZhSize: number
  /** 主窗字幕字体 key（见 renderer caption-fonts.ts）；'default' 跟随界面等宽字体 */
  captionFont: string
  /** 英文行字重：400 常规 / 500 适中 / 700 加粗 / 800 特粗 */
  captionWeight: number
  /** 字幕文字阴影 */
  captionShadow: boolean
  /** 字幕浮层质感：纯色 / 毛玻璃 / 无边框 */
  captionTexture: CaptionTexture
  /** 取词弹窗打开时自动朗读发音 */
  autoSpeakOnLookup: boolean
  /** 查词成功后自动加入生词本 */
  autoCollectWord: boolean
  /** 悬停字幕单词自动弹出翻译（悬停 300ms 触发） */
  hoverTranslate: boolean
  /** 跟读脚本生成策略 */
  shadowingStrategy: ShadowingStrategy
/** 收藏难度估算方式：freq = 离线词频估（免费即时），llm = LLM 精估（花 token 更准） */
  levelEstimator: 'freq' | 'llm'
  /** 收藏时自动打内容标签（LLM，需配置；手动改过的标签不被覆盖） */
  autoTag: boolean
}

export interface AppData {
  folders: Folder[]
  favorites: Favorite[]
  vocab: VocabItem[]
  settings: Settings
  /** 跟读脚本，按 videoId 索引 */
  shadowing: Record<string, ShadowingScript>
  /** 学习统计：按日（YYYY-MM-DD）记录复习次数与认识次数 */
  stats: Record<string, { reviewed: number; known: number }>
}

export const DEFAULT_SETTINGS: Settings = {
  enabledTranslators: ['local', 'google'],
  llm: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini' },
  captionOpacity: 0.72,
  theme: 'night',
  accentColor: 'green',
  showZhSubtitle: false,
  showCaptions: true,
  captionFontSize: 20,
  captionZhSize: 16,
  captionFont: 'default',
  captionWeight: 400,
  captionShadow: true,
  captionTexture: 'solid',
  autoSpeakOnLookup: false,
  autoCollectWord: false,
  hoverTranslate: false,
  shadowingStrategy: 'llm-fallback',
  levelEstimator: 'freq',
  autoTag: true
}

export function defaultData(): AppData {
  return {
    folders: [],
    favorites: [],
    vocab: [],
    settings: DEFAULT_SETTINGS,
    shadowing: {},
    stats: {}
  }
}
