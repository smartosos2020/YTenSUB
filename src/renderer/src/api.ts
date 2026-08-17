import type { YTenSubApi } from '../../preload/index'

const raw = (window as unknown as { api: YTenSubApi }).api

export const SETTINGS_CHANGED_EVENT = 'ytensub:settings-changed'
export const FAVS_CHANGED_EVENT = 'ytensub:favs-changed'

export const api: YTenSubApi = {
  ...raw,
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
  }
}
