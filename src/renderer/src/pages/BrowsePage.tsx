import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { WebviewTag } from 'electron'
import { api, SETTINGS_CHANGED_EVENT } from '../api'
import { alignCuesToEn, Cue, parseCaptionText } from '../../../shared/captions'
import { EXTRACT_SCRIPT } from '../../../shared/extract'
import { Folder } from '../../../shared/types'
import SubtitlePanel, { WordSelection } from '../components/SubtitlePanel'
import FavoritesTab from '../components/FavoritesTab'
import CaptionOverlay from '../components/CaptionOverlay'
import TranslatePopup from '../components/TranslatePopup'

interface VideoInfo {
  videoId: string
  title: string
  channel: string
}

interface HostMessage {
  kind: 'page' | 'time' | 'guest-mousedown' | 'esc'
  videoId?: string | null
  url?: string
  time?: number
}

function toUrl(input: string): string {
  const s = input.trim()
  if (!s) return 'https://www.youtube.com'
  if (/^https?:\/\//.test(s)) return s
  return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(s)
}

export default function BrowsePage(): JSX.Element {
  const [searchParams] = useSearchParams()
  const initialUrl = searchParams.get('v')
    ? `https://www.youtube.com/watch?v=${encodeURIComponent(searchParams.get('v')!)}` +
      (searchParams.get('t') ? `&t=${Number(searchParams.get('t'))}s` : '')
    : 'https://www.youtube.com'

  const [preloadPath, setPreloadPath] = useState<string | null>(null)
  // src 仅用于 webview 初次挂载；之后所有导航走 loadURL，
  // 否则把 guest 上报的 URL 回写 src 会把 SPA 导航变成整页重载
  const [src] = useState(initialUrl)
  const [addressInput, setAddressInput] = useState(initialUrl)
  const [video, setVideo] = useState<VideoInfo | null>(null)
  const [cues, setCues] = useState<Cue[]>([])
  const [time, setTime] = useState(0)
  const [hasCaptions, setHasCaptions] = useState(true)
  const [isFav, setIsFav] = useState(false)
  const [favMenuOpen, setFavMenuOpen] = useState(false)
  const [folders, setFolders] = useState<Folder[]>([])
  const [selection, setSelection] = useState<WordSelection | null>(null)
  const [captionOpacity, setCaptionOpacity] = useState(0.72)
  const [fsMode, setFsMode] = useState(false)
  // 中文字幕：showZh 来自设置（默认关）；zhNative 为视频自带/YouTube 机翻轨对齐结果，
  // zhTrans 为 Google 批量翻译结果（zhNative 为空时才翻译）
  const [showZh, setShowZh] = useState(false)
  const [zhNative, setZhNative] = useState<(string | null)[] | null>(null)
  const [zhTrans, setZhTrans] = useState<(string | null)[] | null>(null)
  const [zhLoading, setZhLoading] = useState(false)
  // 翻译任务序号：换视频或重开开关时作废旧任务
  const zhJobRef = useRef(0)
  // 右侧标签面板：字幕（默认）/ 收藏
  const [sideTab, setSideTab] = useState<'subs' | 'favs'>('subs')
  const wvRef = useRef<WebviewTag | null>(null)
  // 弹窗打开时是否视频原本在播：关闭弹窗时据此恢复播放
  const resumeOnCloseRef = useRef(false)
  const popupOpenRef = useRef(false)
  // 应用级全屏相关：拦截原生全屏后忽略其 leave 事件
  const fsIgnoreLeaveRef = useRef(false)
  const fsModeRef = useRef(false)

  /** 打开翻译弹窗；首次打开时暂停视频并记住播放状态 */
  const openSelection = useCallback((sel: WordSelection): void => {
    const firstOpen = !popupOpenRef.current
    popupOpenRef.current = true
    setSelection(sel)
    if (firstOpen) {
      wvRef.current
        ?.executeJavaScript(
          '(() => { const v = document.querySelector("video"); if (!v) return false; const wasPlaying = !v.paused; v.pause(); return wasPlaying })()'
        )
        .then((wasPlaying) => {
          resumeOnCloseRef.current = !!wasPlaying
        })
        .catch(() => {})
    }
  }, [])

  /** 关闭翻译弹窗；只有打开前在播的视频才恢复播放 */
  const closeSelection = useCallback((): void => {
    if (!popupOpenRef.current) return
    popupOpenRef.current = false
    setSelection(null)
    if (resumeOnCloseRef.current) {
      resumeOnCloseRef.current = false
      wvRef.current
        ?.executeJavaScript('(() => { const v = document.querySelector("video"); if (v) void v.play() })()')
        .catch(() => {})
    }
  }, [])

  useEffect(() => {
    api.getWebviewPreloadPath().then(setPreloadPath)
  }, [])

  // 字幕浮层透明度与中文字幕开关：从设置加载，设置保存后即时刷新
  useEffect(() => {
    const load = (): void => {
      api.settingsGet().then((s) => {
        setCaptionOpacity(s.captionOpacity ?? 0.72)
        setShowZh(s.showZhSubtitle ?? false)
      })
    }
    load()
    window.addEventListener(SETTINGS_CHANGED_EVENT, load)
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, load)
  }, [])

  /** 中文字幕开关：写入设置持久化（默认关闭） */
  const toggleZh = useCallback((v: boolean): void => {
    setShowZh(v)
    void api.settingsSet({ showZhSubtitle: v })
  }, [])

  // 视频没有自己的中文字幕（zhNative 为空）时，打开开关后用整句批量翻译代替，分块渐进显示
  useEffect(() => {
    if (!showZh || cues.length === 0 || zhNative || zhTrans) return
    const job = ++zhJobRef.current
    setZhLoading(true)
    const CHUNK = 30
    const acc: (string | null)[] = new Array(cues.length).fill(null)
    void (async () => {
      try {
        for (let i = 0; i < cues.length; i += CHUNK) {
          const part = await api.translateZhBatch(cues.slice(i, i + CHUNK).map((c) => c.text))
          if (zhJobRef.current !== job) return
          for (let j = 0; j < part.length; j++) acc[i + j] = part[j]
          setZhTrans([...acc])
        }
      } finally {
        if (zhJobRef.current === job) setZhLoading(false)
      }
    })()
  }, [showZh, cues, zhNative, zhTrans])

  /** 进入应用级全屏：guest 播放器铺满视口，隐藏宿主界面元素，保留字幕浮层 */
  const enterFs = useCallback((): void => {
    fsModeRef.current = true
    setFsMode(true)
    wvRef.current
      ?.executeJavaScript("document.body.classList.add('el-fs')")
      .catch(() => {})
  }, [])

  /** 退出应用级全屏：同时让 YouTube 自身退出全屏状态，恢复页面布局 */
  const exitFs = useCallback((): void => {
    fsModeRef.current = false
    setFsMode(false)
    wvRef.current
      ?.executeJavaScript(
        "document.body.classList.remove('el-fs');" +
          'if (document.fullscreenElement) void document.exitFullscreen();' +
          "var p = document.getElementById('movie_player');" +
          "if (p && p.classList.contains('ytp-fullscreen')) {" +
          "  var b = p.querySelector('.ytp-fullscreen-button');" +
          '  if (b) b.click();' +
          '}'
      )
      .catch(() => {})
  }, [])

  /** Esc：先关翻译弹窗，其次退出应用级全屏。宿主与 guest 的按键都会走到这里，两次调用幂等 */
  const handleEscape = useCallback((): void => {
    if (popupOpenRef.current) closeSelection()
    else if (fsModeRef.current) exitFs()
  }, [closeSelection, exitFs])

  // 全屏时隐藏侧栏/导航栏/字幕面板（通过 body class）
  useEffect(() => {
    document.body.classList.toggle('el-app-fs', fsMode)
    return () => document.body.classList.remove('el-app-fs')
  }, [fsMode])

  /** 切换视频或提取失败时重置中文字幕状态，并作废进行中的翻译任务 */
  const resetZh = useCallback((): void => {
    zhJobRef.current++
    setZhNative(null)
    setZhTrans(null)
    setZhLoading(false)
  }, [])

  const extract = useCallback(async (wv: WebviewTag): Promise<void> => {
    try {
      const res = await wv.executeJavaScript(EXTRACT_SCRIPT)
      if (res?.ok && res.videoId) {
        const parsed = parseCaptionText(res.captionText)
        if (res.hasCaptions && parsed.length === 0) {
          console.warn('[ytensub] 字幕解析为空:', res.captionError ?? 'unknown')
        }
        // 中文轨（视频自带或 YouTube 机翻 tlang）：有则按时间轴对齐到英文字幕
        const zhParsed = parseCaptionText(res.zhCaptionText)
        zhJobRef.current++
        setZhNative(zhParsed.length ? alignCuesToEn(parsed, zhParsed) : null)
        setZhTrans(null)
        setZhLoading(false)
        setVideo({ videoId: res.videoId, title: res.title, channel: res.channel })
        setHasCaptions(res.hasCaptions)
        setCues(parsed)
        setIsFav(await api.favIs(res.videoId))
      } else {
        setVideo(null)
        setCues([])
        resetZh()
      }
    } catch {
      setVideo(null)
      setCues([])
      resetZh()
    }
  }, [resetZh])

  useEffect(() => {
    const wv = wvRef.current
    if (!wv) return
    const onMsg = (e: Event): void => {
      const ev = e as unknown as { channel: string; args: HostMessage[] }
      if (ev.channel !== 'ytensub') return
      const msg = ev.args[0]
      if (msg.kind === 'page') {
        if (msg.url) setAddressInput(msg.url)
        if (msg.videoId) {
          void extract(wv)
        } else {
          setVideo(null)
          setCues([])
          resetZh()
        }
      } else if (msg.kind === 'time' && typeof msg.time === 'number') {
        setTime(msg.time)
      } else if (msg.kind === 'guest-mousedown') {
        closeSelection()
      } else if (msg.kind === 'esc') {
        // webview 获得焦点时按键只进 guest，由 preload 转发回来
        handleEscape()
      }
    }
    // 隐藏 YouTube 原生字幕 + 应用级全屏的播放器样式（同时隐藏会遮挡播放器的页面元素）
    const onDomReady = (): void => {
      wv
        .insertCSS(
          '.caption-window, .ytp-caption-window-container { display: none !important; }' +
            'body.el-fs #movie_player { position: fixed !important; inset: 0 !important; z-index: 2147483646 !important; width: 100vw !important; height: 100vh !important; background: #000 !important; }' +
            'body.el-fs .html5-video-container, body.el-fs #movie_player video { width: 100% !important; height: 100% !important; }' +
            'body.el-fs #secondary, body.el-fs #chat, body.el-fs #masthead-container { display: none !important; }'
        )
        .catch(() => {})
    }
    // 原生全屏会把 webview 扩展到整个窗口、盖住宿主层的字幕浮层，
    // 因此立即退出原生全屏，改为应用级全屏
    const onEnterFs = (): void => {
      fsIgnoreLeaveRef.current = true
      wv
        .executeJavaScript('if (document.fullscreenElement) void document.exitFullscreen()')
        .catch(() => {})
      enterFs()
    }
    const onLeaveFs = (): void => {
      if (fsIgnoreLeaveRef.current) {
        fsIgnoreLeaveRef.current = false
        return
      }
      exitFs()
    }
    wv.addEventListener('ipc-message', onMsg)
    wv.addEventListener('dom-ready', onDomReady)
    wv.addEventListener('enter-html-full-screen', onEnterFs)
    wv.addEventListener('leave-html-full-screen', onLeaveFs)
    return () => {
      wv.removeEventListener('ipc-message', onMsg)
      wv.removeEventListener('dom-ready', onDomReady)
      wv.removeEventListener('enter-html-full-screen', onEnterFs)
      wv.removeEventListener('leave-html-full-screen', onLeaveFs)
    }
  }, [extract, preloadPath, closeSelection, enterFs, exitFs, handleEscape, resetZh])

  // Escape：先关翻译弹窗，其次退出应用级全屏
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      handleEscape()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [handleEscape])

  const seek = useCallback((t: number): void => {
    wvRef.current?.executeJavaScript(
      `(() => { const v = document.querySelector('video'); if (v) { v.currentTime = ${JSON.stringify(t)}; void v.play(); } })()`
    )
  }, [])

  const navigate = (): void => {
    const url = toUrl(addressInput)
    setAddressInput(url)
    wvRef.current?.loadURL(url).catch(() => {})
  }

  const openFavMenu = async (): Promise<void> => {
    if (isFav) {
      if (video) {
        await api.favRemove(video.videoId)
        setIsFav(false)
      }
      return
    }
    setFolders(await api.folderList())
    setFavMenuOpen((v) => !v)
  }

  const addToFolder = async (folderId: string | null): Promise<void> => {
    if (!video) return
    await api.favAdd({
      videoId: video.videoId,
      title: video.title,
      channel: video.channel,
      thumbnail: `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`,
      folderId
    })
    setIsFav(true)
    setFavMenuOpen(false)
  }

  return (
    <div className="browse-page">
      <div className="navbar">
        <button onClick={() => wvRef.current?.goBack()}>←</button>
        <button onClick={() => wvRef.current?.goForward()}>→</button>
        <button onClick={() => wvRef.current?.reload()}>⟳</button>
        <input
          value={addressInput}
          onChange={(e) => setAddressInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && navigate()}
          placeholder="输入 YouTube 链接，或输入关键词搜索"
        />
        <button onClick={navigate}>打开</button>
        <div className="fav-wrap">
          <button disabled={!video} onClick={openFavMenu}>
            {isFav ? '★ 已收藏' : '☆ 收藏'}
          </button>
          {favMenuOpen && video && (
            <div className="fav-menu">
              <div className="fav-menu-title">收藏到</div>
              <button onClick={() => void addToFolder(null)}>未分类</button>
              {folders.map((f) => (
                <button key={f.id} onClick={() => void addToFolder(f.id)}>
                  {f.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="browse-body">
        <div className="video-wrap">
          {preloadPath && (
            <webview
              ref={(el) => {
                wvRef.current = el as unknown as WebviewTag | null
              }}
              src={src}
              preload={preloadPath}
              className="webview"
            />
          )}
          <CaptionOverlay
            cues={cues}
            time={time}
            opacity={captionOpacity}
            showZh={showZh}
            zhLines={zhNative ?? zhTrans}
            onWordSelect={openSelection}
          />
        </div>
        <div className="side-panel">
          <div className="side-tabs">
            <button
              className={sideTab === 'subs' ? 'selected' : ''}
              onClick={() => setSideTab('subs')}
            >
              字幕
            </button>
            <button
              className={sideTab === 'favs' ? 'selected' : ''}
              onClick={() => setSideTab('favs')}
            >
              收藏
            </button>
          </div>
          {sideTab === 'subs' ? (
            <SubtitlePanel
              cues={cues}
              time={time}
              hasCaptions={hasCaptions}
              onSeek={seek}
              onWordSelect={openSelection}
              showZh={showZh}
              zhLines={zhNative ?? zhTrans}
              zhLoading={zhLoading}
              onShowZhChange={toggleZh}
            />
          ) : (
            <FavoritesTab />
          )}
        </div>
      </div>
      {selection && video && (
        <TranslatePopup
          text={selection.text}
          rect={selection.rect}
          sentence={selection.sentence}
          video={{ videoId: video.videoId, title: video.title }}
          time={time}
          onClose={closeSelection}
        />
      )}
      {fsMode && (
        <button className="fs-exit" onClick={exitFs}>
          退出全屏 (Esc)
        </button>
      )}
    </div>
  )
}
