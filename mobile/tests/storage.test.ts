import { describe, expect, it } from 'vitest'
import { mergeVocab, VocabItem } from '../src/lib/storage'

// mergeVocab 是纯函数，规则与桌面端 src/main/sync.ts 的同名函数一致
//（逐行比对相同：按词去重，掌握等级取高，其余字段取 addedAt 较新者，
//  reviewDue 跟随等级来源方）。根仓库 tests/ 没有对应测试，以下为新增。

function vocab(text: string, addedAt: number, reviewLevel?: number, reviewDue?: number): VocabItem {
  return {
    id: `${text}-${addedAt}`,
    text,
    translation: `tr:${text}`,
    videoId: 'v',
    videoTitle: 't',
    timestamp: 0,
    sentence: '',
    addedAt,
    reviewLevel,
    reviewDue
  }
}

describe('mergeVocab 生词合并', () => {
  it('无重复时 local + incoming 全部保留', () => {
    const merged = mergeVocab([vocab('a', 1)], [vocab('b', 2), vocab('c', 3)])
    expect(merged.map((v) => v.text).sort()).toEqual(['a', 'b', 'c'])
  })

  it('同词不同形态（大小写/空白）去重为一条', () => {
    const merged = mergeVocab([vocab(' Run ', 1)], [vocab('run', 2)])
    expect(merged).toHaveLength(1)
  })

  it('其余字段取较新者，等级取高（可来自较旧者），due 跟随等级来源', () => {
    const older = vocab('run', 1, 2, 200)
    const newer = vocab('RUN', 5, 1, 500) // 较新但等级低
    const merged = mergeVocab([older], [newer])
    expect(merged).toHaveLength(1)
    expect(merged[0].addedAt).toBe(5)
    expect(merged[0].translation).toBe('tr:RUN')
    expect(merged[0].reviewLevel).toBe(2) // 等级取高，来自较旧者
    expect(merged[0].reviewDue).toBe(200) // due 跟随等级来源（较旧者）
  })

  it('等级来自较新者时 due 用较新者的', () => {
    const older = vocab('run', 1, 1, 100)
    const newer = vocab('run', 5, 3, 300)
    const merged = mergeVocab([older], [newer])
    expect(merged[0].reviewLevel).toBe(3)
    expect(merged[0].reviewDue).toBe(300)
  })

  it('reviewLevel 缺省按 0 参与比较', () => {
    const merged = mergeVocab(
      [vocab('run', 1, undefined, undefined)],
      [vocab('run', 2, 0, 50)]
    )
    expect(merged[0].reviewLevel).toBe(0)
    expect(merged[0].reviewDue).toBe(50)
  })
})
