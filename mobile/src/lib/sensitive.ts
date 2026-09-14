/**
 * 敏感话题过滤（意识形态/政治议题）：与桌面端 src/shared/sensitive.ts 同源（同步拷贝）。
 * 判定三路：内容标签命中（News & Politics 映射的"新闻"）→ 频道名单 → 标题关键词。
 * 名单维护：直接改本文件发版；宁漏勿滥（误伤学习内容的代价比漏过敏感内容大）。
 * 开关由服务端全局下发（admin 控制，见 auth.ts fetchFilterSensitive），客户端不做本地持久化。
 */

/** 命中即过滤的内容标签（见 types.ts mapYtCategoryToTag："新闻" ← News & Politics） */
export const SENSITIVE_TAGS: readonly string[] = ['新闻']

/** 命中即过滤的频道（按频道名，与 CuratedVideo.channel 对齐） */
export const SENSITIVE_CHANNELS: readonly string[] = [
  'BBC World Service',
  'DW News',
  'ABC News',
  'CBS Mornings',
  'NBC News',
  'Al Jazeera English',
  'The Atlantic'
]

/**
 * 标题关键词（小写包含匹配）。聚焦政治/意识形态：选举、政党、战争、地缘冲突、社会运动。
 * 保持克制——词根尽量长到不至于误伤日常教学用语（如不用 war 而用 warfare? 不，war 在标题里
 * 作政治含义时通常带上下文词，这里直接收 war 但依赖前两路已覆盖新闻频道，标题路只兜底）。
 */
export const SENSITIVE_TITLE_KEYWORDS: readonly string[] = [
  'trump', 'biden', 'harris', 'putin', 'zelensky', 'xi jinping',
  'election', 'president', 'presidential', 'white house', 'congress', 'senate',
  'democrat', 'republican', 'gop', 'impeach', 'inaugurat',
  'ukraine', 'gaza', 'israel', 'palestin', 'hamas', 'hezbollah', 'iran regime',
  'nato', 'geopolitic', 'sanction', 'coup', 'junta', 'dictator', 'propaganda',
  'protest', 'riot', 'martial law', 'referendum', 'populis', 'nationalis',
  'communis', 'socialis', 'fascis', 'ideolog',
  'tariff', 'trade war', 'cold war',
  '政治', '选举', '总统', '政党', '意识形态', '战争', '制裁', '抗议'
]

export interface SensitiveCheckTarget {
  title?: string
  channel?: string
  channelId?: string
  tags?: string[]
  ytCategory?: string
}

export function isSensitiveVideo(v: SensitiveCheckTarget): boolean {
  if (v.ytCategory === 'News & Politics') return true
  if (v.tags?.some((t) => SENSITIVE_TAGS.includes(t))) return true
  if (v.channel && SENSITIVE_CHANNELS.includes(v.channel)) return true
  const title = v.title?.toLowerCase() ?? ''
  return SENSITIVE_TITLE_KEYWORDS.some((k) => title.includes(k))
}

/** 对列表应用过滤；filterOn=false 原样返回 */
export function filterSensitiveVideos<T extends SensitiveCheckTarget>(list: T[], filterOn: boolean): T[] {
  if (!filterOn) return list
  return list.filter((v) => !isSensitiveVideo(v))
}
