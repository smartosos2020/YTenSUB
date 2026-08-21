import { app, BrowserWindow, ipcMain, Menu, nativeTheme, net } from 'electron'
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

// 自定义标题栏（titleBarStyle: hidden）下，原生窗口按钮由 overlay 绘制，颜色跟随主题
const TB_OVERLAY_NIGHT = { color: '#0f0f0f', symbolColor: '#f1f1f1', height: 36 }
const TB_OVERLAY_DAY = { color: '#ffffff', symbolColor: '#0f0f0f', height: 36 }
let mainWin: BrowserWindow | null = null

// 应用主题映射为全局模拟的 prefers-color-scheme：
// YouTube（设备主题模式）跟随系统媒体查询，借此让 guest 页面跟随我们的夜晚/白天
nativeTheme.themeSource = store.getSettings().theme === 'day' ? 'light' : 'dark'

// resources/** 打进 app.asar，dev 与打包版用同一相对路径（Electron 的 fs 可直接读 asar 内文件）
const dictPath = path.join(__dirname, '..', '..', 'resources', 'dict.json')
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
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => {
    const r = store.setSettings(patch)
    // 主题变更即时反映到全局模拟的 prefers-color-scheme 与标题栏按钮配色
    if (patch.theme) {
      nativeTheme.themeSource = patch.theme === 'day' ? 'light' : 'dark'
      mainWin?.setTitleBarOverlay(patch.theme === 'day' ? TB_OVERLAY_DAY : TB_OVERLAY_NIGHT)
    }
    return r
  })

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
    // 窗口/任务栏图标：asar 内路径对 dev 与打包版一致（resources/** 会被打进 app.asar）
    icon: path.join(__dirname, '..', '..', 'resources', 'icon.png'),
    autoHideMenuBar: true,
    // 隐藏原生标题栏，由渲染进程绘制标题栏；右上角保留原生窗口按钮（overlay）
    titleBarStyle: 'hidden',
    titleBarOverlay:
      store.getSettings().theme === 'day' ? TB_OVERLAY_DAY : TB_OVERLAY_NIGHT,
    backgroundColor: '#0f0f0f',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      webviewTag: true,
      contextIsolation: true
    }
  })
  mainWin = win
  win.on('closed', () => {
    mainWin = null
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL + '/#/browse')
  } else {
    win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), { hash: '/browse' })
  }
}

app.whenReady().then(() => {
  // 与 electron-builder 的 appId 一致：Windows 任务栏分组/通知才用应用图标而不是 Electron 默认图标
  if (process.platform === 'win32') app.setAppUserModelId('com.ytensub.app')
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
