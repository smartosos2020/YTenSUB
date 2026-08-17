import { app, BrowserWindow, ipcMain, Menu, net } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { Store } from './store'
import { Dict } from './dict'
import { googleTranslateFree, llmTranslate, translateBatch, translateText } from './translate'
import { Favorite, Settings, TranslateSource, VocabItem } from '../shared/types'

const dataFile = path.join(app.getPath('userData'), 'ytensub-data.json')

// 项目更名为 YTenSUB：把旧 EngLearn 的数据文件迁移过来（新文件已存在则跳过）
function migrateLegacyData(): void {
  if (fs.existsSync(dataFile)) return
  const appData = app.getPath('appData')
  const candidates = [
    path.join(app.getPath('userData'), 'englearn-data.json'),
    path.join(appData, 'englearn', 'englearn-data.json'),
    path.join(appData, 'EngLearn', 'englearn-data.json')
  ]
  for (const old of candidates) {
    try {
      if (!fs.existsSync(old)) continue
      fs.mkdirSync(path.dirname(dataFile), { recursive: true })
      fs.renameSync(old, dataFile)
      return
    } catch {
      // 迁移失败不影响启动
    }
  }
}
migrateLegacyData()

const store = new Store(dataFile)

const dictPath = app.isPackaged
  ? path.join(process.resourcesPath, 'resources', 'dict.json')
  : path.join(__dirname, '..', '..', 'resources', 'dict.json')
const dict = new Dict(dictPath)

const TRANSLATOR_ORDER: TranslateSource[] = ['local', 'google', 'llm']

function registerIpc(): void {
  ipcMain.handle('translate:text', (_e, text: string) => {
    const s = store.getSettings()
    const enabled = TRANSLATOR_ORDER.filter((t) => s.enabledTranslators.includes(t))
    return translateText(text, {
      localLookup: (w) => {
        const hit = dict.lookup(w)
        return hit ? { translation: hit.t, phonetic: hit.p } : null
      },
      googleTranslate: (t) => googleTranslateFree(t, (u) => net.fetch(u)),
      llmTranslate: (t) => llmTranslate(t, s.llm, (u, init) => net.fetch(u, init)),
      enabled
    })
  })

  // 字幕整句中译：独立于划词翻译设置，Google 优先，LLM（已配置时）兜底；
  // 进程内缓存，同一视频重复打开或开关切换不重复请求
  const zhLineCache = new Map<string, string>()
  ipcMain.handle('translate:zh-batch', (_e, texts: string[]) => {
    const s = store.getSettings()
    const enabled: TranslateSource[] = ['google']
    if (s.llm.baseUrl && s.llm.apiKey && s.llm.model) enabled.push('llm')
    const translateOne = async (t: string): Promise<string | null> => {
      const hit = zhLineCache.get(t)
      if (hit) return hit
      const r = await translateText(t, {
        localLookup: () => null, // 整句翻译不查单词词典
        googleTranslate: (x) => googleTranslateFree(x, (u) => net.fetch(u)),
        llmTranslate: (x) => llmTranslate(x, s.llm, (u, init) => net.fetch(u, init)),
        enabled
      })
      if (r?.translation) {
        zhLineCache.set(t, r.translation)
        return r.translation
      }
      return null
    }
    const input = Array.isArray(texts) ? texts.map((t) => String(t ?? '').trim()) : []
    return translateBatch(input, translateOne, 4)
  })

  ipcMain.handle('vocab:add', (_e, item: Omit<VocabItem, 'id' | 'addedAt'>) => store.addVocab(item))
  ipcMain.handle('vocab:list', () => store.listVocab())
  ipcMain.handle('vocab:remove', (_e, id: string) => store.removeVocab(id))

  ipcMain.handle('fav:add', (_e, fav: Omit<Favorite, 'addedAt'>) => store.addFavorite(fav))
  ipcMain.handle('fav:list', (_e, folderId?: string | null) => store.listFavorites(folderId))
  ipcMain.handle('fav:remove', (_e, videoId: string) => store.removeFavorite(videoId))
  ipcMain.handle('fav:is', (_e, videoId: string) => store.isFavorite(videoId))

  ipcMain.handle('folder:add', (_e, name: string) => store.addFolder(name))
  ipcMain.handle('folder:list', () => store.listFolders())
  ipcMain.handle('folder:remove', (_e, id: string) => store.removeFolder(id))

  ipcMain.handle('settings:get', () => store.getSettings())
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => store.setSettings(patch))

  ipcMain.handle('webview:preload-path', () => {
    const p = path.join(__dirname, '..', 'preload', 'webview-preload.js')
    return 'file:///' + p.replace(/\\/g, '/')
  })
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'YTenSUB',
    autoHideMenuBar: true,
    backgroundColor: '#060907',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      webviewTag: true,
      contextIsolation: true
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL + '/#/browse')
  } else {
    win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), { hash: '/browse' })
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  store.flush()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => store.flush())
