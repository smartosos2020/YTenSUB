import lemmatizer from 'wink-lemmatizer'
import { MASTERED_LEVEL, VocabItem } from '../../shared/types'

/**
 * 词形还原（词元化）：running→run、ran→run、geese→goose、better→good。
 * 生词收藏统一存词元，字幕/脚本高亮也按词元匹配，不同形态互相关联。
 * 还原顺序：动词 → 名词 → 形容词，都不变则原样返回（小写）。
 * 顺序保证一致性：保存与高亮走同一函数，歧义词（如 leaves）两侧结果相同即可关联。
 */
export function lemmatize(word: string): string {
  const w = word.trim().toLowerCase()
  if (!w) return w
  const v = lemmatizer.verb(w)
  if (v !== w) return v
  const n = lemmatizer.noun(w)
  if (n !== w) return n
  return lemmatizer.adjective(w)
}

/** 生词列表 → 高亮用词元集合（已掌握的满级单词不再高亮） */
export function toKnownLemmas(list: VocabItem[]): Set<string> {
  return new Set(
    list.filter((v) => (v.reviewLevel ?? 0) < MASTERED_LEVEL).map((v) => lemmatize(v.text))
  )
}

/** 按词元在生词本里查已收藏词条（字幕点词判断"已添加"用） */
export function findSavedByLemma(list: VocabItem[], text: string): VocabItem | null {
  const lemma = lemmatize(text)
  return list.find((v) => lemmatize(v.text) === lemma) ?? null
}
