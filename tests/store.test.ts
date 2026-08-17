import { describe, expect, it } from 'vitest'
import { Store } from '../src/main/store'
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

  it('收藏按 videoId 去重更新', () => {
    const { store } = makeStore()
    store.addFavorite({ videoId: 'v1', title: 'a', channel: 'c', thumbnail: '', folderId: null })
    store.addFavorite({ videoId: 'v1', title: 'b', channel: 'c', thumbnail: '', folderId: null })
    expect(store.listFavorites()).toHaveLength(1)
    expect(store.listFavorites()[0].title).toBe('b')
    expect(store.isFavorite('v1')).toBe(true)
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
})
