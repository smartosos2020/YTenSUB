import { describe, expect, it } from 'vitest'
import { lemmatize } from '../src/lib/lemma'

// 移植自根仓库 tests/lemma.test.ts 的 lemmatize 部分（5 例）。
// 根文件里 toKnownLemmas / findSavedByLemma 两个 describe 未移植：
// mobile 拷贝（src/lib/lemma.ts）没有这两个导出。
describe('lemmatize 词形还原', () => {
  it('规则变形：进行时 / 过去式 / 复数', () => {
    expect(lemmatize('running')).toBe('run')
    expect(lemmatize('played')).toBe('play')
    expect(lemmatize('cats')).toBe('cat')
  })

  it('不规则变形：ran / geese / better', () => {
    expect(lemmatize('ran')).toBe('run')
    expect(lemmatize('geese')).toBe('goose')
    expect(lemmatize('better')).toBe('good')
  })

  it('大小写与空白归一', () => {
    expect(lemmatize(' Running ')).toBe('run')
    expect(lemmatize('CATS')).toBe('cat')
  })

  it('原形词保持不变', () => {
    expect(lemmatize('apple')).toBe('apple')
  })

  it('同一单词任意形态得到同一词元（高亮/收藏一致性）', () => {
    const forms = ['run', 'runs', 'ran', 'running']
    const lemmas = new Set(forms.map(lemmatize))
    expect(lemmas.size).toBe(1)
  })

  it('任意异常输入不抛异常', () => {
    for (const w of ['', '   ', '123', '!!!', '👍', 'résumé', 'a'.repeat(1000)]) {
      expect(() => lemmatize(w)).not.toThrow()
      expect(typeof lemmatize(w)).toBe('string')
    }
  })
})
