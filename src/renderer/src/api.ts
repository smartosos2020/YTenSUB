import type { YTenSubApi } from '../../preload/index'

const raw = (window as unknown as { api: YTenSubApi }).api

export const SETTINGS_CHANGED_EVENT = 'ytensub:settings-changed'
export const FAVS_CHANGED_EVENT = 'ytensub:favs-changed'
export const VOCAB_CHANGED_EVENT = 'ytensub:vocab-changed'

export const api: YTenSubApi = {
  ...raw,
  // 生词增删后广播事件，让字幕里的已添加单词高亮即时刷新
  vocabAdd: async (item) => {
    const r = await raw.vocabAdd(item)
    window.dispatchEvent(new Event(VOCAB_CHANGED_EVENT))
    return r
  },
  vocabRemove: async (id) => {
    const r = await raw.vocabRemove(id)
    window.dispatchEvent(new Event(VOCAB_CHANGED_EVENT))
    return r
  },
  // 复习结算后同样广播：达到掌握等级的单词要即时从字幕高亮里移除
  vocabReview: async (id, level) => {
    const r = await raw.vocabReview(id, level)
    window.dispatchEvent(new Event(VOCAB_CHANGED_EVENT))
    return r
  },
  // 设置保存后广播事件，让常驻的 Browse 页即时应用（如字幕透明度）
  settingsSet: async (patch) => {
    const r = await raw.settingsSet(patch)
    window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT))
    return r
  },
  // 收藏增删后广播事件，让浏览页左侧收藏列表即时刷新
  favAdd: async (fav) => {
    const r = await raw.favAdd(fav)
    window.dispatchEvent(new Event(FAVS_CHANGED_EVENT))
    return r
  },
  favRemove: async (videoId) => {
    const r = await raw.favRemove(videoId)
    window.dispatchEvent(new Event(FAVS_CHANGED_EVENT))
    return r
  },
  favMove: async (videoId, folderId) => {
    const r = await raw.favMove(videoId, folderId)
    window.dispatchEvent(new Event(FAVS_CHANGED_EVENT))
    return r
  }
}
