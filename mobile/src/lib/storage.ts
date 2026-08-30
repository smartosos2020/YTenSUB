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
