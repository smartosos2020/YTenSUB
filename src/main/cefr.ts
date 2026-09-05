import lemmatizer from 'wink-lemmatizer'
import { CefrLevel } from '../shared/types'
import { Cue } from '../shared/captions'

/** 词典词频查询接口（Dict 实现） */
export interface FreqLookup {
  freqRank(word: string): number | null
}

/**
 * 离线 CEFR 难度估算：统计字幕中超出 COCA 前 3000 词的占比，按档位映射。
 * 词形先归一（wink-lemmatizer）；词典查不到的词（专名等）不计入统计，避免虚高。
 * 只反映词汇难度（语速/语法不在内），作为筛选参考够用。
 */
export function estimateLevelByFreq(cues: Cue[], dict: FreqLookup): CefrLevel | null {
  let known = 0
  let beyond3000 = 0
  for (const cue of cues) {
    for (const part of cue.text.split(/\s+/)) {
      const w = part.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '').toLowerCase()
      if (!/^[a-z][a-z'-]*$/.test(w)) continue
      const lemma = lemmaOf(w)
      const rank = dict.freqRank(lemma) ?? dict.freqRank(w)
      if (rank === null) continue // 词典未收录（专名/生僻）：不计入
      known++
      if (rank > 3000) beyond3000++
    }
  }
  if (known < 100) return null // 样本太少不估
  const r = beyond3000 / known
  if (r < 0.01) return 'A1'
  if (r < 0.025) return 'A2'
  if (r < 0.05) return 'B1'
  if (r < 0.09) return 'B2'
  if (r < 0.14) return 'C1'
  return 'C2'
}

/** 词形归一（与渲染层 lemmatize 同序：动词→名词→形容词） */
function lemmaOf(w: string): string {
  const v = lemmatizer.verb(w)
  if (v !== w) return v
  const n = lemmatizer.noun(w)
  if (n !== w) return n
  return lemmatizer.adjective(w)
}
