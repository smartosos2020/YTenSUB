import { describe, expect, it } from 'vitest'
import { estimateLevelByFreq, FreqLookup } from '../src/main/cefr'
import { Cue } from '../src/shared/captions'

/** 假词频表：前 3000 以内给低 rank，之外的词给大 rank，未收录返回 null */
function fakeDict(inside3000: string[], beyond: string[]): FreqLookup {
  return {
    freqRank: (w) => {
      if (inside3000.includes(w)) return 500
      if (beyond.includes(w)) return 20000
      return null
    }
  }
}

const cuesOf = (words: string[], repeat: number): Cue[] => {
  const text = Array(repeat).fill(words.join(' ')).join('. ')
  return [{ start: 0, dur: 10, text }]
}

describe('estimateLevelByFreq 离线难度估算', () => {
  it('全是常见词 → A1/A2 档', () => {
    const dict = fakeDict(['the', 'cat', 'sit', 'on', 'mat'], [])
    const lv = estimateLevelByFreq(cuesOf(['the', 'cat', 'sit', 'on', 'the', 'mat'], 40), dict)
    expect(lv).toBe('A1')
  })

  it('超纲词占比高 → 高档位；词形归一后统计', () => {
    const dict = fakeDict(['the', 'is'], ['serendipity', 'obfuscate', 'paradigm', 'quintessential'])
    // 一半常见词，一半超纲词（含变形 running 不在假表里→不计入）
    const lv = estimateLevelByFreq(
      cuesOf(['the', 'serendipity', 'is', 'obfuscate', 'the', 'paradigm', 'is', 'quintessential'], 30),
      dict
    )
    expect(lv).toBe('C2')
  })

  it('样本太少不估', () => {
    const dict = fakeDict(['hello'], [])
    expect(estimateLevelByFreq(cuesOf(['hello'], 5), dict)).toBeNull()
  })

  it('词典未收录的词（专名）不计入统计', () => {
    const dict = fakeDict(['the', 'cat', 'sit'], [])
    const lv = estimateLevelByFreq(cuesOf(['the', 'cat', 'sit', 'Hermione', 'Gryffindor'], 40), dict)
    expect(lv).toBe('A1')
  })
})

describe('mapYtCategoryToTag YouTube 分类映射', () => {
  it('官方分类映射到预设标签', async () => {
    const { mapYtCategoryToTag } = await import('../src/shared/types')
    expect(mapYtCategoryToTag('Education')).toBe('教育')
    expect(mapYtCategoryToTag('Science & Technology')).toBe('科技')
    expect(mapYtCategoryToTag('People & Blogs')).toBe('生活')
  })

  it('未知/缺失分类返回 null（留给 LLM）', async () => {
    const { mapYtCategoryToTag } = await import('../src/shared/types')
    expect(mapYtCategoryToTag('Shows')).toBeNull()
    expect(mapYtCategoryToTag(undefined)).toBeNull()
    expect(mapYtCategoryToTag('')).toBeNull()
  })
})
