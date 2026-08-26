import { describe, expect, it } from 'vitest'
import { Store } from '../src/main/store'
import { REVIEW_INTERVALS_MS } from '../src/shared/types'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function makeStore(): { store: Store; file: string } {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'store-')), 'data.json')
  return { store: new Store(file), file }
}

describe('Store', () => {
  it('文件夹增删；删文件夹时收藏归为未分类', () => {
    const { store } = makeStore()
    const folder = store.addFolder('TED 演讲')
    expect(store.listFolders()).toHaveLength(1)

    store.addFavorite({ videoId: 'v1', title: 't', channel: 'c', thumbnail: '', folderId: folder.id })
    store.removeFolder(folder.id)
    expect(store.listFolders()).toHaveLength(0)
    expect(store.listFavorites()[0].folderId).toBeNull()
  })

  it('收藏按 videoId 去重更新；可移动分类', () => {
    const { store } = makeStore()
    store.addFavorite({ videoId: 'v1', title: 'a', channel: 'c', thumbnail: '', folderId: null })
    store.addFavorite({ videoId: 'v1', title: 'b', channel: 'c', thumbnail: '', folderId: null })
    expect(store.listFavorites()).toHaveLength(1)
    expect(store.listFavorites()[0].title).toBe('b')
    expect(store.isFavorite('v1')).toBe(true)

    const folder = store.addFolder('TED')
    store.moveFavorite('v1', folder.id)
    expect(store.listFavorites()[0].folderId).toBe(folder.id)
    store.moveFavorite('v1', null)
    expect(store.listFavorites()[0].folderId).toBeNull()
    store.moveFavorite('nope', folder.id) // 不存在静默忽略

    store.removeFavorite('v1')
    expect(store.isFavorite('v1')).toBe(false)
  })

  it('生词按词去重并更新来源', () => {
    const { store } = makeStore()
    const base = {
      translation: '你好',
      videoId: 'v1',
      videoTitle: 'Video One',
      timestamp: 10,
      sentence: 'hello world'
    }
    store.addVocab({ text: 'Hello', ...base })
    const updated = store.addVocab({ text: 'hello', ...base, videoId: 'v2', videoTitle: 'Video Two' })
    expect(store.listVocab()).toHaveLength(1)
    expect(updated.videoId).toBe('v2')
  })

  it('持久化：flush 后新实例能读到数据', () => {
    const { store, file } = makeStore()
    store.addVocab({
      text: 'persist',
      translation: '坚持',
      videoId: 'v1',
      videoTitle: 't',
      timestamp: 0,
      sentence: ''
    })
    store.flush()
    const store2 = new Store(file)
    expect(store2.listVocab()[0].text).toBe('persist')
  })

  it('settings 局部更新合并 llm 字段', () => {
    const { store } = makeStore()
    store.setSettings({ llm: { baseUrl: '', apiKey: 'k', model: 'm' } })
    store.setSettings({ enabledTranslators: ['local'] })
    const s = store.getSettings()
    expect(s.enabledTranslators).toEqual(['local'])
    expect(s.llm.apiKey).toBe('k')
  })

  it('损坏的数据文件回退到默认值', () => {
    const { file } = makeStore()
    fs.writeFileSync(file, 'not json', 'utf8')
    const store = new Store(file)
    expect(store.listVocab()).toEqual([])
    expect(store.getSettings().enabledTranslators).toContain('local')
  })

  it('跟读脚本按 videoId 存取', () => {
    const { store } = makeStore()
    expect(store.getShadowing('v1')).toBeNull()
    store.setShadowing({
      videoId: 'v1',
      title: 't',
      generatedAt: 1,
      items: [{ text: 'Hello there.', zh: '你好。', start: 1, dur: 2 }]
    })
    expect(store.getShadowing('v1')?.items).toHaveLength(1)
  })

  it('复习结算：写入等级并计算到期时间；越界等级被钳制', () => {
    const { store } = makeStore()
    const item = store.addVocab({
      text: 'word',
      translation: '词',
      videoId: 'v1',
      videoTitle: 't',
      timestamp: 0,
      sentence: ''
    })
    const before = Date.now()
    store.updateVocabReview(item.id, 2)
    const after = store.listVocab()[0]
    expect(after.reviewLevel).toBe(2)
    expect(after.reviewDue).toBeGreaterThanOrEqual(before + REVIEW_INTERVALS_MS[2])
    store.updateVocabReview(item.id, 99)
    expect(store.listVocab()[0].reviewLevel).toBe(REVIEW_INTERVALS_MS.length - 1)
    // 不存在的 id 静默忽略
    store.updateVocabReview('nope', 1)
  })

  it('主文件损坏时从 .bak 恢复上一次完好的数据', () => {
    const { store, file } = makeStore()
    store.addVocab({
      text: 'backup',
      translation: '备份',
      videoId: 'v1',
      videoTitle: 't',
      timestamp: 0,
      sentence: ''
    })
    store.flush() // 第一次写：尚无 .bak
    store.addVocab({
      text: 'newer',
      translation: '更新',
      videoId: 'v2',
      videoTitle: 't',
      timestamp: 1,
      sentence: ''
    })
    store.flush() // 第二次写：.bak = 第一次的内容
    fs.writeFileSync(file, 'corrupted!!!', 'utf8')
    const store2 = new Store(file)
    expect(store2.listVocab().map((v) => v.text)).toEqual(['backup'])
  })
})
