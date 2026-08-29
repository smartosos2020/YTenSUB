import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import fs from 'node:fs'
import path from 'node:path'
import { Store } from './store'
import { Dict } from './dict'
import { googleTranslateFree, llmChatDetailed, llmTranslate, translateBatch, translateText } from './translate'
import { buildShadowingMessages, fetchEnglishCues, mergeCuesToSentences, parseShadowingResponse, ruleBasedPick, withSceneNumbers } from './shadowing'
import { Favorite, Settings, ShadowingScript, TranslateSource, VocabItem, defaultData } from '../shared/types'

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

let mainWin: BrowserWindow | null = null

// 应用主题映射为全局模拟的 prefers-color-scheme：
// YouTube（设备主题模式）跟随系统媒体查询，借此让 guest 页面跟随我们的夜晚/白天
const initialTheme = store.getSettings().theme
nativeTheme.themeSource =
  initialTheme === 'day' ? 'light' : initialTheme === 'night' ? 'dark' : 'system'

// resources/** 打进 app.asar，dev 与打包版用同一相对路径（Electron 的 fs 可直接读 asar 内文件）
const dictPath = path.join(__dirname, '..', '..', 'resources', 'dict.json')
const dict = new Dict(dictPath)

const TRANSLATOR_ORDER: TranslateSource[] = ['local', 'google', 'llm']

function registerIpc(): void {
  ipcMain.handle('translate:text', (_e, text: string) => {
    const s = store.getSettings()
    // 数组顺序即优先级（设置页可上下移调整）
    const enabled = s.enabledTranslators.filter((t) => TRANSLATOR_ORDER.includes(t))
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
  // 缓存上限 1000 条：超限时清掉最旧的一半（Map 按插入序迭代），防长 session 内存膨胀
  const cacheZhLine = (key: string, value: string): void => {
    if (zhLineCache.size >= 1000) {
      const keys = zhLineCache.keys()
      for (let i = 0; i < 500; i++) {
        const k = keys.next()
        if (k.done) break
        zhLineCache.delete(k.value)
      }
    }
    zhLineCache.set(key, value)
  }
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
        cacheZhLine(t, r.translation)
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
  ipcMain.handle('vocab:review', (_e, id: string, level: number) =>
    store.updateVocabReview(id, level)
  )

  ipcMain.handle('fav:add', (_e, fav: Omit<Favorite, 'addedAt'>) => store.addFavorite(fav))
  ipcMain.handle('fav:list', (_e, folderId?: string | null) => store.listFavorites(folderId))
  ipcMain.handle('fav:remove', (_e, videoId: string) => store.removeFavorite(videoId))
  ipcMain.handle('fav:is', (_e, videoId: string) => store.isFavorite(videoId))
  ipcMain.handle('fav:move', (_e, videoId: string, folderId: string | null) =>
    store.moveFavorite(videoId, folderId)
  )

  ipcMain.handle('folder:add', (_e, name: string) => store.addFolder(name))
  ipcMain.handle('folder:list', () => store.listFolders())
  ipcMain.handle('folder:remove', (_e, id: string) => store.removeFolder(id))

  ipcMain.handle('settings:get', () => store.getSettings())
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => {
    const r = store.setSettings(patch)
    // 主题变更即时反映到全局模拟的 prefers-color-scheme
    if (patch.theme) {
      nativeTheme.themeSource =
        patch.theme === 'day' ? 'light' : patch.theme === 'night' ? 'dark' : 'system'
    }
    return r
  })

  // 自定义标题栏（frame: false）的窗口控制
  ipcMain.on('window:minimize', () => mainWin?.minimize())
  ipcMain.on('window:toggle-maximize', () => {
    if (!mainWin) return
    if (mainWin.isMaximized()) mainWin.unmaximize()
    else mainWin.maximize()
  })
  ipcMain.on('window:close', () => mainWin?.close())

  // 版本与更新：侧栏版本号 + 更新可用提示
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.on('update:install', () => autoUpdater.quitAndInstall())
  // 手动检查更新（点侧栏版本号触发）：返回结果供渲染进程给瞬时反馈
  ipcMain.handle('update:check', async (): Promise<'available' | 'latest' | 'error'> => {
    try {
      const r = await autoUpdater.checkForUpdates()
      const latest = r?.updateInfo?.version
      return latest && latest !== app.getVersion() ? 'available' : 'latest'
    } catch {
      return 'error'
    }
  })
  // 自动更新不可用时的临时方案：打开 GitHub 发布页手动下载
  ipcMain.on('update:open-releases', () => {
    void shell.openExternal('https://github.com/smartosos2020/YTenSUB/releases/latest')
  })

  // LLM 连通性测试：发一条最小请求并计时
  ipcMain.handle('llm:test', async () => {
    const s = store.getSettings()
    const t0 = Date.now()
    const r = await llmChatDetailed(s.llm, [{ role: 'user', content: 'ping' }], (u, i) =>
      net.fetch(u, i)
    )
    return { ok: r.error === null && r.content !== null, ms: Date.now() - t0 }
  })

  ipcMain.handle('webview:preload-path', () => {
    const p = path.join(__dirname, '..', 'preload', 'webview-preload.js')
    return 'file:///' + p.replace(/\\/g, '/')
  })

  // 通用文本保存（生词 CSV、双语字幕等）：保存对话框 + 写文件，取消返回 null
  ipcMain.handle(
    'file:save-text',
    async (_e, opts: { defaultName: string; content: string; filterName: string; ext: string }) => {
      if (!mainWin) return null
      const r = await dialog.showSaveDialog(mainWin, {
        defaultPath: opts.defaultName,
        filters: [{ name: opts.filterName, extensions: [opts.ext] }]
      })
      if (r.canceled || !r.filePath) return null
      fs.writeFileSync(r.filePath, opts.content, 'utf8')
      return r.filePath
    }
  )

  // 数据备份：导出当前数据文件副本
  ipcMain.handle('data:export', async () => {
    if (!mainWin) return null
    store.flush()
    const r = await dialog.showSaveDialog(mainWin, {
      defaultPath: 'ytensub-backup.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (r.canceled || !r.filePath) return null
    fs.copyFileSync(dataFile, r.filePath)
    return r.filePath
  })

  // 数据恢复：校验结构后整体替换（先留 .bak），渲染进程随后自行 reload
  ipcMain.handle('data:import', async () => {
    if (!mainWin) return null
    const r = await dialog.showOpenDialog(mainWin, {
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (r.canceled || r.filePaths.length === 0) return null
    try {
      const parsed = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'))
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !Array.isArray(parsed.vocab) ||
        !Array.isArray(parsed.favorites) ||
        !Array.isArray(parsed.folders) ||
        typeof parsed.settings !== 'object'
      ) {
        return 'invalid'
      }
      const base = defaultData()
      store.replaceAll({
        ...base,
        ...parsed,
        settings: { ...base.settings, ...(parsed.settings ?? {}) }
      })
      store.flush()
      return 'ok'
    } catch {
      return 'invalid'
    }
  })

  // 真人发音：dictionaryapi.dev 免费接口，查到音频 URL 交给渲染进程播放；进程内缓存
  const pronounceCache = new Map<string, string | null>()
  ipcMain.handle('dict:pronounce', async (_e, word: string) => {
    const w = String(word ?? '').trim().toLowerCase()
    if (!/^[a-z][a-z'-]*$/.test(w)) return null
    const cached = pronounceCache.get(w)
    if (cached !== undefined) return cached
    let url: string | null = null
    try {
      const res = await net.fetch(
        'https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(w)
      )
      if (res.ok) {
        const data = (await res.json()) as { phonetics?: { audio?: string }[] }[]
        url = data?.[0]?.phonetics?.map((p) => p?.audio).find((a) => !!a) ?? null
      }
    } catch {
      // 网络失败按无发音处理
    }
    pronounceCache.set(w, url)
    return url
  })

  // 跟读脚本：读取已生成结果
  ipcMain.handle('shadowing:get', (_e, videoId: string) => store.getShadowing(videoId))

  /**
   * 跟读脚本生成：主进程直接拉字幕（不依赖浏览页），LLM 精选清洗句子，
   * Google 批量出中文释义，写库后返回。已生成过且未指定 force 时直接返回缓存。
   */
  ipcMain.handle('shadowing:generate', async (_e, videoId: string, force?: boolean) => {
    const vid = String(videoId ?? '').trim()
    if (!vid) return { error: 'no-captions' }
    const existing = store.getShadowing(vid)
    if (existing && !force) return { script: existing }

    const caps = await fetchEnglishCues(vid, (u, init) => net.fetch(u, init))
    if (!caps) return { error: 'no-captions' }

    // 碎片 cue 先合并成完整句子：LLM 精选和规则兜底都在句子上工作，效果好得多
    const sentences = mergeCuesToSentences(caps.cues)
    if (sentences.length === 0) return { error: 'no-captions' }

    const s = store.getSettings()
    const strategy = s.shadowingStrategy ?? 'llm-fallback'
    let picked: { i: number; text: string }[] = []
    let generatedBy: 'llm' | 'rules' | 'raw' = 'rules'
    let llmError: string | undefined

    // 管道策略：raw 直接用全部字幕句；rules-only 用本地规则；llm-only 失败即报错；llm-fallback 失败回落规则
    if (strategy === 'raw') {
      picked = sentences.map((unit, i) => ({ i, text: unit.text }))
      generatedBy = 'raw'
    } else if (strategy !== 'rules-only') {
      const llmReady = s.llm.baseUrl && s.llm.apiKey && s.llm.model
      if (!llmReady) {
        llmError = 'LLM 未配置完整'
        if (strategy === 'llm-only') return { error: 'no-llm' }
      } else {
        const r = await llmChatDetailed(s.llm, buildShadowingMessages(sentences), (u, init) =>
          net.fetch(u, init)
        )
        if (r.error) {
          llmError = r.error
          console.error('[ytensub] 跟读脚本 LLM 调用失败:', r.error)
        } else if (r.content) {
          picked = parseShadowingResponse(r.content, sentences.length)
          if (picked.length === 0) {
            llmError = 'LLM 输出无法解析'
            console.error('[ytensub] 跟读脚本 LLM 输出解析失败:', r.content.slice(0, 200))
          }
        }
        if (picked.length > 0) generatedBy = 'llm'
      }
      if (picked.length === 0 && strategy === 'llm-only')
        return { error: 'llm-failed', detail: llmError }
    }
    if (picked.length === 0 && strategy !== 'raw') {
      picked = ruleBasedPick(sentences)
      generatedBy = 'rules'
      if (picked.length === 0) return { error: 'llm-failed', detail: llmError }
    }

    // 中文释义：Google 优先，LLM 兜底（与字幕中译同链）
    const translateOne = async (t: string): Promise<string | null> => {
      const r = await translateText(t, {
        localLookup: () => null,
        googleTranslate: (x) => googleTranslateFree(x, (u) => net.fetch(u)),
        llmTranslate: (x) => llmTranslate(x, s.llm, (u, init) => net.fetch(u, init)),
        enabled: ['google', 'llm']
      })
      return r?.translation ?? null
    }
    const zh = await translateBatch(
      picked.map((p) => p.text),
      translateOne,
      4
    )

    // 场景分组：连续序号为同一场景，断开开新场景，保持叙事延续性
    const scenes = withSceneNumbers(picked)

    const script: ShadowingScript = {
      videoId: vid,
      title: caps.title,
      generatedAt: Date.now(),
      generatedBy,
      llmError,
      items: picked.map((p, idx) => {
        const unit = sentences[p.i]
        return {
          text: p.text,
          zh: zh[idx] ?? null,
          start: unit.start,
          dur: Math.max(1, unit.end - unit.start),
          scene: scenes[idx]
        }
      })
    }
    store.setShadowing(script)
    return { script }
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
    // 无边框窗口：标题栏由渲染进程自绘（含最小化/最大化/关闭按钮）
    frame: false,
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
  // 最大化状态推给渲染进程，用于切换 最大化/还原 图标
  win.on('maximize', () => win.webContents.send('window:maximize-changed', true))
  win.on('unmaximize', () => win.webContents.send('window:maximize-changed', false))

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
  // 自动更新（GitHub Releases）：静默检查，下载完成后提示重启安装；dev 环境静默跳过
  // updater 全事件写日志到 userData/updater.log（更新失败时排查用）
  const updaterLogFile = path.join(app.getPath('userData'), 'updater.log')
  const logUpdater = (msg: string): void => {
    const line = `${new Date().toISOString()} ${msg}\n`
    try {
      fs.appendFileSync(updaterLogFile, line)
    } catch {
      /* 日志失败不影响主流程 */
    }
  }
  logUpdater(`checkForUpdatesAndNotify (app v${app.getVersion()})`)
  autoUpdater.checkForUpdatesAndNotify().catch((e) => logUpdater(`check error: ${String(e)}`))
  // 定时重查（4 小时）：启动时若撞上 GitHub CDN 缓存拿到"无更新"，运行中也能自愈
  const timer = setInterval(() => {
    logUpdater('periodic re-check')
    autoUpdater.checkForUpdates().catch((e) => logUpdater(`periodic check error: ${String(e)}`))
  }, 4 * 3600 * 1000)
  timer.unref()
  // 更新状态推给渲染进程：侧栏版本号旁的下载图标据此显示进度
  autoUpdater.on('checking-for-update', () => logUpdater('checking-for-update'))
  autoUpdater.on('update-not-available', () => logUpdater('update-not-available'))
  autoUpdater.on('update-available', (info) => {
    logUpdater(`update-available: v${info.version}`)
    mainWin?.webContents.send('update:available')
  })
  autoUpdater.on('download-progress', (p) => {
    logUpdater(
      `download-progress: ${Math.round(p.percent)}% (${Math.round(p.bytesPerSecond / 1024)}KB/s, ${Math.round(p.transferred / 1048576)}MB/${Math.round(p.total / 1048576)}MB)`
    )
    mainWin?.webContents.send('update:progress', Math.round(p.percent))
  })
  autoUpdater.on('update-downloaded', (info) => {
    logUpdater(`update-downloaded: v${info.version}`)
    mainWin?.webContents.send('update:downloaded')
  })
  autoUpdater.on('error', (e) => {
    logUpdater(`error: ${String(e)}`)
    mainWin?.webContents.send('update:error', String(e))
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  store.flush()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => store.flush())
