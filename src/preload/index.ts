import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import { Favorite, Settings, VocabItem } from '../shared/types'

const api = {
  translate: (text: string) => ipcRenderer.invoke('translate:text', text),
  translateZhBatch: (texts: string[]) => ipcRenderer.invoke('translate:zh-batch', texts),

  vocabAdd: (item: Omit<VocabItem, 'id' | 'addedAt'>) => ipcRenderer.invoke('vocab:add', item),
  vocabList: () => ipcRenderer.invoke('vocab:list'),
  vocabRemove: (id: string) => ipcRenderer.invoke('vocab:remove', id),

  favAdd: (fav: Omit<Favorite, 'addedAt'>) => ipcRenderer.invoke('fav:add', fav),
  favList: (folderId?: string | null) => ipcRenderer.invoke('fav:list', folderId),
  favRemove: (videoId: string) => ipcRenderer.invoke('fav:remove', videoId),
  favIs: (videoId: string) => ipcRenderer.invoke('fav:is', videoId),

  folderAdd: (name: string) => ipcRenderer.invoke('folder:add', name),
  folderList: () => ipcRenderer.invoke('folder:list'),
  folderRemove: (id: string) => ipcRenderer.invoke('folder:remove', id),

  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsSet: (patch: Partial<Settings>) => ipcRenderer.invoke('settings:set', patch),

  // 自定义标题栏的窗口控制
  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowToggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  windowClose: () => ipcRenderer.send('window:close'),
  onWindowMaximizeChanged: (cb: (maximized: boolean) => void) => {
    const listener = (_e: IpcRendererEvent, v: boolean): void => cb(v)
    ipcRenderer.on('window:maximize-changed', listener)
    return () => {
      ipcRenderer.removeListener('window:maximize-changed', listener)
    }
  },

  getWebviewPreloadPath: () => ipcRenderer.invoke('webview:preload-path')
}

export type YTenSubApi = typeof api

contextBridge.exposeInMainWorld('api', api)
