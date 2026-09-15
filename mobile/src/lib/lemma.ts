import lemmatizer from 'wink-lemmatizer'

// 词元化失败日志去重（同一词只报一次）
const lemmatizeErrorLogged = new Set<string>()
let lemmatizeErrorSink: ((msg: string) => void) | null = null

/** 注册词元化失败的日志出口（App 启动时挂 BgPlayer.log） */
export function setLemmatizeErrorSink(sink: (msg: string) => void): void {
  lemmatizeErrorSink = sink
}

/**
 * 与桌面端 src/renderer/src/lemma.ts 同源（MVP 先拷贝，后续抽公共包）。
 * 词形还原（词元化）：running→run、ran→run、geese→goose、better→good。
 * 还原顺序：动词 → 名词 → 形容词，都不变则原样返回（小写）。
 * 任何输入都不许抛异常：词元化只是高亮辅助，失败按原样返回。
 * 注：桌面 renderer 版另有 toKnownLemmas / findSavedByLemma 两个导出（服务桌面生词高亮），
 * 手机端无使用处，按最小化原则不拷贝。
 */
export function lemmatize(word: string): string {
  const w = word.trim().toLowerCase()
  if (!w) return w
  try {
    const v = lemmatizer.verb(w)
    if (v !== w) return v
    const n = lemmatizer.noun(w)
    if (n !== w) return n
    return lemmatizer.adjective(w)
  } catch {
    if (!lemmatizeErrorLogged.has(w)) {
      lemmatizeErrorLogged.add(w)
      lemmatizeErrorSink?.(`lemmatize 失败: ${JSON.stringify(w)}`)
    }
    return w
  }
}
