import AsyncStorage from '@react-native-async-storage/async-storage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  favList,
  favToggle,
  mergeVocab,
  vocabAdd,
  vocabList,
  vocabRemove,
  vocabReview,
  VocabItem
} from '../src/lib/storage'
import { pullFromDesktop } from '../src/lib/sync'
import { __resetAsyncStorage } from './mocks/async-storage'

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

describe('storage 异步并发写串行化', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    __resetAsyncStorage()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('并发 vocabAdd / vocabReview / vocabRemove 不会互相覆盖丢更新', async () => {
    const origGet = AsyncStorage.getItem.bind(AsyncStorage)
    const origSet = AsyncStorage.setItem.bind(AsyncStorage)
    let delayStep = 0
    vi.spyOn(AsyncStorage, 'getItem').mockImplementation(async (k: string) => {
      const ms = (delayStep++ % 2 === 0) ? 12 : 2
      await new Promise((r) => setTimeout(r, ms))
      return origGet(k)
    })
    vi.spyOn(AsyncStorage, 'setItem').mockImplementation(async (k: string, v: string) => {
      await new Promise((r) => setTimeout(r, 4))
      return origSet(k, v)
    })

    const base = { videoId: 'v1', videoTitle: 't1', timestamp: 1, sentence: 's' }
    await Promise.all([
      vocabAdd({ ...base, text: 'apple', translation: '苹果' }),
      vocabAdd({ ...base, text: 'banana', translation: '香蕉' }),
      vocabAdd({ ...base, text: 'cherry', translation: '樱桃' })
    ])

    const added = await vocabList()
    expect(added.map((v) => v.text).sort()).toEqual(['apple', 'banana', 'cherry'])

    const apple = added.find((v) => v.text === 'apple')!
    const banana = added.find((v) => v.text === 'banana')!
    const cherry = added.find((v) => v.text === 'cherry')!

    await Promise.all([
      vocabReview(apple.id, 2),
      vocabReview(banana.id, 4),
      vocabRemove(cherry.id)
    ])

    const after = await vocabList()
    expect(after.map((v) => v.text).sort()).toEqual(['apple', 'banana'])
    expect(after.find((v) => v.id === apple.id)?.reviewLevel).toBe(2)
    expect(after.find((v) => v.id === banana.id)?.reviewLevel).toBe(4)
  })

  it('并发 favToggle 不会互相覆盖', async () => {
    const origGet = AsyncStorage.getItem.bind(AsyncStorage)
    vi.spyOn(AsyncStorage, 'getItem').mockImplementation(async (k: string) => {
      await new Promise((r) => setTimeout(r, 5))
      return origGet(k)
    })

    await Promise.all([
      favToggle({ videoId: 'v1', title: 'One', channel: 'C1' }),
      favToggle({ videoId: 'v2', title: 'Two', channel: 'C2' })
    ])

    const favs = await favList()
    expect(favs.map((f) => f.videoId).sort()).toEqual(['v1', 'v2'])
  })

  it('pullFromDesktop 与本地 vocabAdd 交错执行不会覆盖新增生词', async () => {
    const base = { videoId: 'v1', videoTitle: 't1', timestamp: 1, sentence: 's' }
    await vocabAdd({ ...base, text: 'initial', translation: '初始' })

    const origGet = AsyncStorage.getItem.bind(AsyncStorage)
    const origSet = AsyncStorage.setItem.bind(AsyncStorage)
    vi.spyOn(AsyncStorage, 'getItem').mockImplementation(async (k: string) => {
      await new Promise((r) => setTimeout(r, 10))
      return origGet(k)
    })
    vi.spyOn(AsyncStorage, 'setItem').mockImplementation(async (k: string, v: string) => {
      await new Promise((r) => setTimeout(r, 10))
      return origSet(k, v)
    })

    globalThis.fetch = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5))
      return new Response(
        JSON.stringify({
          version: 1,
          exportedAt: Date.now(),
          vocab: [vocab('desktop-word', Date.now())],
          shadowing: []
        }),
        { status: 200 }
      )
    }) as typeof fetch

    // 拉取同步与本地新增词并发交错
    const pullPromise = pullFromDesktop('http://127.0.0.1:47832', 'tok')
    const addDuringPull = new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        vocabAdd({ ...base, text: 'added-during-sync', translation: '同步期间新增' })
          .then(resolve, reject)
      }, 8)
    })

    await Promise.all([pullPromise, addDuringPull])

    const finalList = await vocabList()
    expect(finalList.map((v) => v.text).sort()).toEqual([
      'added-during-sync',
      'desktop-word',
      'initial'
    ])
  })
})
