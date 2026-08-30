import lemmatizer from 'wink-lemmatizer'

/**
 * 与桌面端 src/renderer/src/lemma.ts 同源（MVP 先拷贝，后续抽公共包）。
 * 词形还原（词元化）：running→run、ran→run、geese→goose、better→good。
 * 还原顺序：动词 → 名词 → 形容词，都不变则原样返回（小写）。
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
