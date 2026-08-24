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

  vocabReview: (id: string, level: number) => ipcRenderer.invoke('vocab:review', id, level),
  saveTextFile: (opts: { defaultName: string; content: string; filterName: string; ext: string }) =>
    ipcRenderer.invoke('file:save-text', opts),
  dataExport: () => ipcRenderer.invoke('data:export'),
  dataImport: () => ipcRenderer.invoke('data:import'),
  dictPronounce: (word: string) => ipcRenderer.invoke('dict:pronounce', word),
  shadowingGet: (videoId: string) => ipcRenderer.invoke('shadowing:get', videoId),
  shadowingGenerate: (videoId: string) => ipcRenderer.invoke('shadowing:generate', videoId),
  llmTest: () => ipcRenderer.invoke('llm:test'),

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
