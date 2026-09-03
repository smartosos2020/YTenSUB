import AsyncStorage from '@react-native-async-storage/async-storage'

/** 生词条目（与桌面端 VocabItem 对齐，便于将来互通导入） */
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
  /** 复习等级（REVIEW_INTERVALS_MS 下标）；undefined = 从未复习 */
  reviewLevel?: number
  /** 下次到期时间戳 */
  reviewDue?: number
}

/** 复习间隔：等级 0~5 对应 10分钟/1天/3天/7天/15天/30天；满 5 级视为已掌握 */
export const REVIEW_INTERVALS_MS = [
  10 * 60_000,
  86_400_000,
  3 * 86_400_000,
  7 * 86_400_000,
  15 * 86_400_000,
  30 * 86_400_000
]
export const MASTERED_LEVEL = 5

/** 复习结算：写入新等级并按间隔表算出下次到期时间 */
export async function vocabReview(id: string, level: number): Promise<void> {
  const list = await vocabList()
  const item = list.find((v) => v.id === id)
  if (!item) return
  const lv = Math.max(0, Math.min(REVIEW_INTERVALS_MS.length - 1, level))
  item.reviewLevel = lv
  item.reviewDue = Date.now() + REVIEW_INTERVALS_MS[lv]
  await saveAll(list)
}

const KEY = 'ytensub:vocab'

/** 读取整个生词本（新收藏在前） */
export async function vocabList(): Promise<VocabItem[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    const arr = raw ? (JSON.parse(raw) as VocabItem[]) : []
    return [...arr].sort((a, b) => b.addedAt - a.addedAt)
  } catch {
    return []
  }
}

async function saveAll(list: VocabItem[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(list))
}

/** 收藏生词（统一存词元；同词再次添加=更新翻译与来源、刷新时间） */
export async function vocabAdd(item: Omit<VocabItem, 'id' | 'addedAt'>): Promise<void> {
  const list = await vocabList()
  const key = item.text.trim().toLowerCase()
  const idx = list.findIndex((v) => v.text.trim().toLowerCase() === key)
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...item, addedAt: Date.now() }
  } else {
    list.push({ ...item, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, addedAt: Date.now() })
  }
  await saveAll(list)
}

export async function vocabRemove(id: string): Promise<void> {
  const list = await vocabList()
  await saveAll(list.filter((v) => v.id !== id))
}

/** 生词合并（与桌面端 sync.ts 同规则）：按词去重，掌握等级取高，其余取新 */
export function mergeVocab(local: VocabItem[], incoming: VocabItem[]): VocabItem[] {
  const byText = new Map<string, VocabItem>()
  for (const v of [...local, ...incoming]) {
    const key = v.text.trim().toLowerCase()
    const cur = byText.get(key)
    if (!cur) {
      byText.set(key, v)
      continue
    }
    const newer = v.addedAt > cur.addedAt ? v : cur
    const older = newer === v ? cur : v
    const level = Math.max(newer.reviewLevel ?? 0, older.reviewLevel ?? 0)
    byText.set(key, {
      ...newer,
      reviewLevel: level,
      reviewDue: level === (newer.reviewLevel ?? 0) ? newer.reviewDue : older.reviewDue
    })
  }
  return [...byText.values()]
}

/** 覆盖式写入整个生词本（同步拉取后用） */
export async function vocabReplaceAll(list: VocabItem[]): Promise<void> {
  await saveAll(list)
}

// ---------- 跟读脚本（桌面端生成，同步过来） ----------

export interface ShadowingItem {
  start: number
  dur: number
  text: string
  zh?: string
  scene?: number
}

export interface ShadowingScript {
  videoId: string
  title: string
  generatedAt: number
  generatedBy?: 'llm' | 'rules' | 'raw'
  items: ShadowingItem[]
}

const SHADOWING_KEY = 'ytensub:shadowing'

export async function shadowingList(): Promise<ShadowingScript[]> {
  try {
    const raw = await AsyncStorage.getItem(SHADOWING_KEY)
    return raw ? Object.values(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

export async function shadowingGet(videoId: string): Promise<ShadowingScript | null> {
  const list = await shadowingList()
  return list.find((s) => s.videoId === videoId) ?? null
}

/** 跟读脚本合并：按 videoId，generatedAt 新者胜 */
export async function shadowingMerge(incoming: ShadowingScript[]): Promise<void> {
  const local = await shadowingList()
  const byId = new Map<string, ShadowingScript>()
  for (const s of [...local, ...incoming]) {
    const cur = byId.get(s.videoId)
    if (!cur || s.generatedAt > cur.generatedAt) byId.set(s.videoId, s)
  }
  await AsyncStorage.setItem(SHADOWING_KEY, JSON.stringify(Object.fromEntries(byId)))
}
