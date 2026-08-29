import { describe, expect, it } from 'vitest'
import { findSavedByLemma, lemmatize, toKnownLemmas } from '../src/renderer/src/lemma'
import { VocabItem } from '../src/shared/types'

function vocab(text: string, reviewLevel?: number): VocabItem {
  return {
    id: text,
    text,
    translation: '',
    videoId: 'v',
    videoTitle: 't',
    timestamp: 0,
    sentence: '',
    addedAt: 0,
    reviewLevel
  }
}

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
})

describe('toKnownLemmas 高亮集合', () => {
  it('按词元收集，满级已掌握词不高亮', () => {
    const set = toKnownLemmas([vocab('Running', 1), vocab('swim', 6)])
    expect(set.has('run')).toBe(true)
    expect(set.has('swim')).toBe(false)
  })
})

describe('findSavedByLemma 已收藏判断', () => {
  it('生词本存 run，点 running 也能命中', () => {
    const list = [vocab('run')]
    expect(findSavedByLemma(list, 'running')?.text).toBe('run')
    expect(findSavedByLemma(list, 'apple')).toBeNull()
  })
})
