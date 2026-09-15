/**
 * 新手词汇量定级向导（⑩）：与桌面端 src/shared/level-test.ts 同源（同步拷贝）。
 * 24 个词（6 档 × 4 词，词表由 scripts/gen-level-test-words.mjs 从词典 COCA 词频生成，
 * 随仓库分发）。用户逐词标记"认识/不认识"，输出估计的 CEFR 等级。
 *
 * 估级规则（粗粒度，定位"推荐起点"而非测评）：
 * 从最简单档往难走，认识率 ≥50% 则升档；遇到首个 <50% 的档就停，定级为上一档。
 * A1 档不足 50% 也兜底 A1（定级向导的目的是给推荐一个起点，不是判定零基础）。
 */
import wordsJson from './level-test-words.json'

// 桌面端在 shared/types.ts；手机端没有该文件，这里同源定义
export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2'
export const CEFR_LEVELS: CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']

export interface LevelTestWord {
  w: string
  /** COCA 词频排名（越小越高频） */
  f: number
}

/** 词表（构建时内联，双端零 IO） */
export const LEVEL_TEST_WORDS: LevelTestWord[] = wordsJson as LevelTestWord[]

/** 词频档 → CEFR（与生成脚本 BANDS 一致） */
export const LEVEL_BANDS: { level: CefrLevel; minF: number; maxF: number }[] = [
  { level: 'A1', minF: 1, maxF: 500 },
  { level: 'A2', minF: 501, maxF: 1500 },
  { level: 'B1', minF: 1501, maxF: 3000 },
  { level: 'B2', minF: 3001, maxF: 6000 },
  { level: 'C1', minF: 6001, maxF: 10000 },
  { level: 'C2', minF: 10001, maxF: 20000 }
]

export function bandIndexOf(f: number): number {
  return LEVEL_BANDS.findIndex((b) => f >= b.minF && f <= b.maxF)
}

export interface LevelAnswer {
  w: string
  known: boolean
}

/** 由答题结果估级；答题数不足 12（一半）视为未完成，返回 null */
export function estimateLevelFromAnswers(answers: LevelAnswer[]): CefrLevel | null {
  if (answers.length < LEVEL_TEST_WORDS.length / 2) return null
  const knownByWord = new Map(answers.map((a) => [a.w, a.known]))
  let levelIdx = 0
  for (let bi = 0; bi < LEVEL_BANDS.length; bi++) {
    const bandWords = LEVEL_TEST_WORDS.filter((x) => bandIndexOf(x.f) === bi)
    if (bandWords.length === 0) continue
    const known = bandWords.filter((x) => knownByWord.get(x.w)).length
    if (known / bandWords.length >= 0.5) levelIdx = bi
    else break
  }
  return CEFR_LEVELS[levelIdx]
}
