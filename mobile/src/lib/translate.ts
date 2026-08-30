import { lemmatize } from './lemma'

export interface TranslateResult {
  translation: string
  phonetic?: string
  /** local = 本地词典，google = Google 免费接口 */
  source: 'local' | 'google'
}

interface DictEntry {
  p?: string
  t: string
}

// 词典懒加载：3.3MB JSON 首次查词时才解析，不拖启动
let dictMap: Record<string, DictEntry> | null = null
function ensureDict(): Record<string, DictEntry> {
  if (dictMap === null) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      dictMap = require('../../assets/dict.json') as Record<string, DictEntry>
    } catch {
      dictMap = {}
    }
  }
  return dictMap
}

/** 本地词典查询：精确命中 → 词元兜底（ran→run 走 wink-lemmatizer） */
function dictLookup(word: string): TranslateResult | null {
  const map = ensureDict()
  const w = word.trim().toLowerCase()
  if (!/^[a-z][a-z'-]*$/.test(w)) return null
  const hit = map[w] ?? map[lemmatize(w)]
  if (!hit) return null
  return { translation: hit.t, phonetic: hit.p, source: 'local' }
}

/** Google 免费翻译接口（与桌面端同一端点） */
async function googleTranslate(text: string): Promise<TranslateResult | null> {
  try {
    const url =
      'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=' +
      encodeURIComponent(text)
    const r = await fetch(url)
    const data = (await r.json()) as unknown[]
    const segs = (data?.[0] as unknown[]) ?? []
    const translation = segs
      .map((s) => (Array.isArray(s) ? String(s[0] ?? '') : ''))
      .join('')
      .trim()
    if (!translation) return null
    return { translation, source: 'google' }
  } catch {
    return null
  }
}

/** 翻译管道：本地词典 → Google。短语/句子跳过词典直接 Google */
export async function translate(text: string): Promise<TranslateResult | null> {
  const t = text.trim()
  if (!t) return null
  if (!/\s/.test(t)) {
    const hit = dictLookup(t)
    if (hit) return hit
  }
  return googleTranslate(t)
}
