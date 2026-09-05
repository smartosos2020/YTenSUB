import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { WebviewTag } from 'electron'
import { api, SETTINGS_CHANGED_EVENT, VOCAB_CHANGED_EVENT } from '../api'
import { Cue, findActiveCueIndex, parseCaptionText, toBilingualSrt } from '../../../shared/captions'
import { EXTRACT_SCRIPT } from '../../../shared/extract'
import { CaptionTexture, Folder, Theme, VocabItem } from '../../../shared/types'
import { toKnownLemmas, findSavedByLemma } from '../lemma'
import { captionFontCss } from '../caption-fonts'
import { registerGuestAudio } from '../guest-audio'
import { useSidePanel } from '../hooks/useSidePanel'
import { useGuestTheme } from '../hooks/useGuestTheme'
import { useZhSubtitles } from '../hooks/useZhSubtitles'
import { useAppFullscreen } from '../hooks/useAppFullscreen'
import { useBackForwardNav } from '../hooks/useBackForwardNav'
import SubtitlePanel, { WordSelection } from '../components/SubtitlePanel'
import FavoritesTab from '../components/FavoritesTab'
import CaptionOverlay from '../components/CaptionOverlay'
import TranslatePopup from '../components/TranslatePopup'
import SidebarToggleIcon from '../components/SidebarToggleIcon'
import BackIcon from '../components/icons/BackIcon'
import ForwardIcon from '../components/icons/ForwardIcon'
import ReloadIcon from '../components/icons/ReloadIcon'
import OpenIcon from '../components/icons/OpenIcon'
import StarIcon from '../components/icons/StarIcon'

interface VideoInfo {
  videoId: string
  title: string
  channel: string
  /** 时长（秒），0/undefined 表示未知 */
  duration?: number
  /** 创作者头像 URL */
  avatar?: string
  /** YouTube 官方分类（自动打标签用） */
  category?: string
}

interface HostMessage {
  kind: 'page' | 'time' | 'guest-mousedown' | 'esc' | 'word'
  videoId?: string | null
  url?: string
  time?: number
  /** guest 划词：选中文本、语境（所在块文本）、guest 视口坐标 */
  text?: string
  sentence?: string
  rect?: { x: number; y: number; width: number; height: number }
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
  // 悬停取词状态：弹窗是否由悬停触发（离开字幕自动关）、鼠标是否在弹窗上、关闭倒计时
  const popupFromHoverRef = useRef(false)
  const popupHoverRef = useRef(false)
  const hoverCloseTimerRef = useRef<number | null>(null)
  const [captionOpacity, setCaptionOpacity] = useState(0.72)
  const [showCaptions, setShowCaptions] = useState(true)
  const [captionFontSize, setCaptionFontSize] = useState(20)
  const [captionZhSize, setCaptionZhSize] = useState(16)
  const [captionFont, setCaptionFont] = useState('default')
  const [captionWeight, setCaptionWeight] = useState(400)
  const [captionShadow, setCaptionShadow] = useState(true)
  // 悬停取词开关（设置页"取词行为"控制）
  const [hoverTranslate, setHoverTranslate] = useState(false)
  const [captionTexture, setCaptionTexture] = useState<CaptionTexture>('solid')
  // 生词本：vocabWords 供字幕橙色高亮（已掌握的满级单词不再高亮）；
  // 列表本身供翻译弹窗判断"已添加"→显示删除按钮
  const [vocabList, setVocabList] = useState<VocabItem[]>([])
  const vocabWords = useMemo(() => toKnownLemmas(vocabList), [vocabList])
  // 应用主题：useGuestTheme 同步到 YouTube guest 页面
  const [theme, setTheme] = useState<Theme>('night')

  const wvRef = useRef<WebviewTag | null>(null)

  const { sideTab, setSideTab, sideCollapsed, toggleSide, sideWidth, startSideResize } =
    useSidePanel()
  const { themeRef, applyGuestTheme } = useGuestTheme(wvRef, theme)
  const { showZh, setShowZh, zhLines, zhLoading, toggleZh, resetZh, loadZhNative, hasZhNative, zhOffset, adjustZhOffset } =
    useZhSubtitles(cues)
  const { fsMode, fsModeRef, fsIgnoreLeaveRef, enterFs, exitFs } = useAppFullscreen(wvRef)
  useBackForwardNav(wvRef)

  // 弹窗打开时视频是否原本在播：关闭弹窗时据此恢复播放
  const resumeOnCloseRef = useRef(false)
  const popupOpenRef = useRef(false)
  // 悬停字幕暂停：取词时不让字幕跑走；wasPlayingRef 记录悬停暂停前的播放状态
  const hoverPauseRef = useRef(false)
  const wasPlayingRef = useRef(false)

  /** 暂停 guest 视频，resolve 暂停前是否在播 */
  const pauseGuestVideo = useCallback((): Promise<boolean> => {
    const wv = wvRef.current
    if (!wv) return Promise.resolve(false)
    return wv
      .executeJavaScript(
        '(() => { const v = document.querySelector("video"); if (!v) return false; const wasPlaying = !v.paused; v.pause(); return wasPlaying })()'
      )
      .then((r) => !!r)
      .catch(() => false)
  }, [])

  const playGuestVideo = useCallback((): void => {
    wvRef.current
      ?.executeJavaScript('(() => { const v = document.querySelector("video"); if (v) void v.play() })()')
      .catch(() => {})
  }, [])

  /**
   * 打开翻译弹窗；首次打开时暂停视频并记住播放状态。
   * 若悬停字幕已把视频暂停（取词场景），以悬停前的播放状态为准。
   */
  const openSelection = useCallback(
    (sel: WordSelection): void => {
      popupFromHoverRef.current = false // 点击/划选路径：弹窗为常驻，不随鼠标离开关闭
      const firstOpen = !popupOpenRef.current
      popupOpenRef.current = true
      setSelection(sel)
      if (!firstOpen) return
      if (hoverPauseRef.current) {
        resumeOnCloseRef.current = wasPlayingRef.current
        return
      }
      void pauseGuestVideo().then((wasPlaying) => {
        resumeOnCloseRef.current = wasPlaying
      })
    },
    [pauseGuestVideo]
  )

  /** 悬停取词：悬停 300ms 弹翻译（与点击同一弹窗、同一暂停逻辑）；标记为悬停弹出，离开字幕自动关 */
  const hoverWord = useCallback(
    (word: string, rect: DOMRect, sentence: string): void => {
      openSelection({ text: word, rect, sentence })
      popupFromHoverRef.current = true
      // 词间移动重开弹窗时取消可能存在的关闭倒计时
      if (hoverCloseTimerRef.current) {
        window.clearTimeout(hoverCloseTimerRef.current)
        hoverCloseTimerRef.current = null
      }
    },
    [openSelection]
  )

  /**
   * 关闭翻译弹窗；只有打开前在播的视频才恢复播放。
   * 关闭时结算悬停状态：鼠标仍停在字幕上则转为悬停暂停，离开字幕时再恢复。
   */
  const closeSelection = useCallback((): void => {
    if (!popupOpenRef.current) return
    popupOpenRef.current = false
    setSelection(null)
    const shouldResume = resumeOnCloseRef.current
    resumeOnCloseRef.current = false
    const stillHovering = !!document.querySelector('.caption-line:hover')
    hoverPauseRef.current = stillHovering
    if (stillHovering) {
      wasPlayingRef.current = shouldResume
      return
    }
    if (shouldResume) playGuestVideo()
  }, [playGuestVideo])

  /** 悬停到字幕：暂停播放，方便取词（弹窗已打开时不重复处理） */
  const onCaptionEnter = useCallback((): void => {
    // 移回字幕：取消悬停弹窗的关闭倒计时
    if (hoverCloseTimerRef.current) {
      window.clearTimeout(hoverCloseTimerRef.current)
      hoverCloseTimerRef.current = null
    }
    if (popupOpenRef.current || hoverPauseRef.current) return
    hoverPauseRef.current = true
    void pauseGuestVideo().then((wasPlaying) => {
      wasPlayingRef.current = wasPlaying
    })
  }, [pauseGuestVideo])

  /** 离开字幕：恢复播放；弹窗打开时保持暂停，等弹窗关闭统一结算。
   *  悬停触发的弹窗：离开字幕 400ms 后自动关闭并恢复播放（移入弹窗则取消） */
  const onCaptionLeave = useCallback((): void => {
    if (popupOpenRef.current) {
      if (popupFromHoverRef.current) {
        if (hoverCloseTimerRef.current) window.clearTimeout(hoverCloseTimerRef.current)
        hoverCloseTimerRef.current = window.setTimeout(() => {
          hoverCloseTimerRef.current = null
          if (!popupHoverRef.current) closeSelection()
        }, 400)
      }
      return
    }
    if (!hoverPauseRef.current) return
    hoverPauseRef.current = false
    if (wasPlayingRef.current) {
      wasPlayingRef.current = false
      playGuestVideo()
    }
  }, [playGuestVideo, closeSelection])

  useEffect(() => {
    api.getWebviewPreloadPath().then(setPreloadPath)
  }, [])

  // 字幕浮层透明度/字号/字体、中文字幕开关与主题：从设置加载，设置保存后即时刷新
  useEffect(() => {
    const load = (): void => {
      api.settingsGet().then((s) => {
        setCaptionOpacity(s.captionOpacity ?? 0.72)
        setShowCaptions(s.showCaptions ?? true)
        setShowZh(s.showZhSubtitle ?? false)
        setTheme(s.theme ?? 'night')
        setCaptionFontSize(s.captionFontSize ?? 20)
        setCaptionFont(s.captionFont ?? 'default')
        setCaptionZhSize(s.captionZhSize ?? 16)
        setCaptionWeight(s.captionWeight ?? 400)
        setCaptionShadow(s.captionShadow ?? true)
        setCaptionTexture(s.captionTexture ?? 'solid')
        setHoverTranslate(s.hoverTranslate ?? false)
      })
    }
    load()
    window.addEventListener(SETTINGS_CHANGED_EVENT, load)
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, load)
  }, [setShowZh])

  // 生词本：加载一次，增删生词后（含生词本页删除）经事件刷新
  useEffect(() => {
    const load = (): void => {
      api
        .vocabList()
        .then((list: VocabItem[]) => setVocabList(list))
        .catch(() => {})
    }
    load()
    window.addEventListener(VOCAB_CHANGED_EVENT, load)
    return () => window.removeEventListener(VOCAB_CHANGED_EVENT, load)
  }, [])

  const extract = useCallback(
    async (wv: WebviewTag, videoId: string): Promise<void> => {
      // 先查本地字幕缓存：命中即秒出（锚点在主进程侧已刷新），未命中才走在线抓取
      const cached = await api.captionsGetCache(videoId).catch(() => null)
      if (cached) {
        loadZhNative(cached.en, cached.zh ?? [])
        setVideo({ videoId, title: cached.title, channel: cached.channel, duration: cached.duration, avatar: cached.avatar, category: cached.ytCategory })
        setHasCaptions(cached.en.length > 0)
        setCues(cached.en)
        setIsFav(await api.favIs(videoId))
        return
      }
      try {
        const res = await wv.executeJavaScript(EXTRACT_SCRIPT)
        if (res?.ok && res.videoId) {
          // 字幕正文走主进程抓取（guest 里会被 YouTube 拖慢 35s+），英中两路并行
          let zhUrl: string | null = res.zhBaseUrl ?? null
          if (!zhUrl && res.enBaseUrl) {
            const u = new URL(res.enBaseUrl)
            u.searchParams.set('tlang', 'zh-Hans') // 无自带中文轨时用 YouTube 机翻轨
            zhUrl = u.toString()
          }
          const [enText, zhText] = await Promise.all([
            res.enBaseUrl ? api.captionsFetchText(res.enBaseUrl) : Promise.resolve(null),
            zhUrl ? api.captionsFetchText(zhUrl) : Promise.resolve(null)
          ])
          const parsed = parseCaptionText(enText)
          if (res.hasCaptions && parsed.length === 0) {
            console.warn('[ytensub] 字幕解析为空')
          }
          const zhParsed = parseCaptionText(zhText)
          loadZhNative(parsed, zhParsed)
          setVideo({ videoId: res.videoId, title: res.title, channel: res.channel, duration: res.duration, avatar: res.channelAvatar, category: res.ytCategory })
          setHasCaptions(res.hasCaptions)
          setCues(parsed)
          setIsFav(await api.favIs(res.videoId))
          // 写入本地缓存：下次打开同视频秒出（空字幕不写，留给下次重试）
          void api
            .captionsPutCache(res.videoId, {
              title: res.title,
              channel: res.channel,
              duration: res.duration,
              avatar: res.channelAvatar,
              ytCategory: res.ytCategory,
              en: parsed,
              zh: zhParsed.length > 0 ? zhParsed : null
            })
            .catch(() => {})
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
    },
    [resetZh, loadZhNative]
  )

  /** Esc：先关翻译弹窗，其次退出应用级全屏。宿主与 guest 的按键都会走到这里，两次调用幂等 */
  const handleEscape = useCallback((): void => {
    if (popupOpenRef.current) closeSelection()
    else if (fsModeRef.current) exitFs()
  }, [closeSelection, exitFs, fsModeRef])

  /** 跳转到指定时间并播放 */
  const seek = useCallback((t: number): void => {
    wvRef.current?.executeJavaScript(
      `(() => { const v = document.querySelector("video"); if (v) { v.currentTime = ${JSON.stringify(t)}; void v.play(); } })()`
    )
  }, [])

  // 单句循环与快捷键需要最新值：用 ref 镜像，避免事件回调闭包过期
  const timeRef = useRef(0)
  const cuesRef = useRef<Cue[]>([])
  const [looping, setLooping] = useState(false)
  const loopRef = useRef(false)
  useEffect(() => {
    cuesRef.current = cues
  }, [cues])
  useEffect(() => {
    loopRef.current = looping
  }, [looping])

  // 原声片段播放（跟读页通过 guest-audio 桥调用）：seek 到句首播放，定时到句尾暂停
  const segmentTimerRef = useRef<number | null>(null)
  const pendingSegmentRef = useRef<{ videoId: string; start: number; dur: number } | null>(null)

  const playSegmentNow = useCallback(
    (start: number, dur: number): void => {
      const wv = wvRef.current
      if (!wv) return
      seek(start)
      if (segmentTimerRef.current) window.clearTimeout(segmentTimerRef.current)
      segmentTimerRef.current = window.setTimeout(() => {
        segmentTimerRef.current = null
        wv
          .executeJavaScript('(() => { const v = document.querySelector("video"); if (v) v.pause() })()')
          .catch(() => {})
      }, Math.max(0.3, dur) * 1000)
    },
    [seek]
  )

  const stopSegment = useCallback((): void => {
    if (segmentTimerRef.current) {
      window.clearTimeout(segmentTimerRef.current)
      segmentTimerRef.current = null
    }
    wvRef.current
      ?.executeJavaScript('(() => { const v = document.querySelector("video"); if (v) v.pause() })()')
      .catch(() => {})
  }, [])

  // 注册原声桥：当前视频相符直接播，否则先加载目标视频（page 消息回来后播待发片段）
  useEffect(
    () =>
      registerGuestAudio({
        playSegment: (vid, start, dur) => {
          if (video?.videoId === vid) {
            playSegmentNow(start, dur)
          } else {
            pendingSegmentRef.current = { videoId: vid, start, dur }
            wvRef.current
              ?.loadURL(`https://www.youtube.com/watch?v=${encodeURIComponent(vid)}`)
              .catch(() => {})
          }
        },
        stop: stopSegment
      }),
    [video?.videoId, playSegmentNow, stopSegment]
  )

  // webview 事件接线（ipc-message / dom-ready / 原生全屏拦截）
  useEffect(() => {
    const wv = wvRef.current
    if (!wv) return
    const onMsg = (e: Event): void => {
      const ev = e as unknown as { channel: string; args: HostMessage[] }
      if (ev.channel !== 'ytensub') return
      const msg = ev.args[0]
      if (msg.kind === 'page') {
        if (msg.url) setAddressInput(msg.url)
        applyGuestTheme(themeRef.current) // SPA 导航后重新断言主题
        if (msg.videoId) {
          void extract(wv, msg.videoId)
          // 跟读页请求的原声片段：等的就是这个视频，加载完成后补播
          const pending = pendingSegmentRef.current
          if (pending && pending.videoId === msg.videoId) {
            pendingSegmentRef.current = null
            window.setTimeout(() => playSegmentNow(pending.start, pending.dur), 1200)
          }
        } else {
          setVideo(null)
          setCues([])
          resetZh()
        }
      } else if (msg.kind === 'time' && typeof msg.time === 'number') {
        setTime(msg.time)
        timeRef.current = msg.time
        // 单句循环：越过当前句结尾就跳回句首重播
        if (loopRef.current) {
          const cs = cuesRef.current
          const idx = findActiveCueIndex(cs, msg.time)
          if (idx >= 0) {
            const c = cs[idx]
            if (msg.time > c.start + Math.max(c.dur, 0.4) + 0.15) seek(c.start)
          }
        }
      } else if (msg.kind === 'guest-mousedown') {
        closeSelection()
      } else if (msg.kind === 'esc') {
        // webview 获得焦点时按键只进 guest，由 preload 转发回来
        handleEscape()
      } else if (msg.kind === 'word' && msg.text && msg.rect) {
        // guest 页面划词（评论区等）：guest 视口坐标 + webview 在宿主中的偏移 = 宿主坐标
        const wvBox = wv.getBoundingClientRect()
        const r = msg.rect
        openSelection({
          text: msg.text,
          sentence: msg.sentence || msg.text,
          rect: new DOMRect(wvBox.left + r.x, wvBox.top + r.y, r.width, r.height)
        })
      }
    }
    // 隐藏 YouTube 原生字幕 + 应用级全屏的播放器样式（同时隐藏会遮挡播放器的页面元素）；
    // guest 页面滚动条样式由 useGuestTheme 按主题注入
    const onDomReady = (): void => {
      wv
        .insertCSS(
          '.caption-window, .ytp-caption-window-container { display: none !important; }' +
            'body.el-fs #movie_player { position: fixed !important; inset: 0 !important; z-index: 2147483646 !important; width: 100vw !important; height: 100vh !important; background: #000 !important; }' +
            'body.el-fs .html5-video-container, body.el-fs #movie_player video { width: 100% !important; height: 100% !important; }' +
            'body.el-fs #secondary, body.el-fs #chat, body.el-fs #masthead-container { display: none !important; }'
        )
        .catch(() => {})
      // 整页加载后同步应用主题（SPA 导航不触发 dom-ready，由 page 消息覆盖）
      applyGuestTheme(themeRef.current)
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
  }, [
    extract,
    preloadPath,
    closeSelection,
    openSelection,
    enterFs,
    exitFs,
    handleEscape,
    resetZh,
    applyGuestTheme,
    themeRef,
    fsIgnoreLeaveRef,
    seek,
    playSegmentNow
  ])

  // Escape：先关翻译弹窗，其次退出应用级全屏
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      handleEscape()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [handleEscape])

  // 播控快捷键（宿主侧）：空格播放/暂停，←/→ 快退快进 5s，↑/↓ 跳上/下一句字幕。
  // webview 聚焦时按键进 guest，由 YouTube 原生快捷键接管；输入框/按钮聚焦时不劫持
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, button, [contenteditable="true"]')) return
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      if (e.key === ' ') {
        e.preventDefault()
        wvRef.current
          ?.executeJavaScript(
            '(() => { const v = document.querySelector("video"); if (v) { if (v.paused) void v.play(); else v.pause() } })()'
          )
          .catch(() => {})
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        seek(Math.max(0, timeRef.current - 5))
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        seek(timeRef.current + 5)
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        const cs = cuesRef.current
        if (cs.length === 0) return
        const idx = findActiveCueIndex(cs, timeRef.current)
        const step = e.key === 'ArrowDown' ? 1 : -1
        const next = Math.min(cs.length - 1, Math.max(0, (idx < 0 ? 0 : idx) + step))
        seek(cs[next].start)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [seek])

  /** 导出双语字幕（SRT）：英文行 + 当前中文行（如有） */
  const exportSubs = (): void => {
    if (cues.length === 0) return
    void api.saveTextFile({
      defaultName: `${video?.title || video?.videoId || 'subtitles'}.srt`,
      content: toBilingualSrt(cues, showZh ? zhLines : null),
      filterName: 'SRT 字幕',
      ext: 'srt'
    })
  }

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
      folderId,
      duration: video.duration,
      avatar: video.avatar,
      ytCategory: video.category
    })
    setIsFav(true)
    setFavMenuOpen(false)
  }

  return (
    <div className="browse-page">
      <div className="navbar">
        <button title="后退" onClick={() => wvRef.current?.goBack()}>
          <BackIcon />
        </button>
        <button title="前进" onClick={() => wvRef.current?.goForward()}>
          <ForwardIcon />
        </button>
        <button title="刷新" onClick={() => wvRef.current?.reload()}>
          <ReloadIcon />
        </button>
        <input
          value={addressInput}
          onChange={(e) => setAddressInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && navigate()}
          placeholder="输入 YouTube 链接，或输入关键词搜索"
        />
        <button title="打开" onClick={navigate}>
          <OpenIcon />
        </button>
        <div className="fav-wrap">
          <button
            className={isFav ? 'fav-toggle active' : 'fav-toggle'}
            disabled={!video}
            title={isFav ? '已收藏（点击取消）' : '收藏'}
            onClick={openFavMenu}
          >
            <StarIcon />
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
        <button title={sideCollapsed ? '展开右栏' : '收起右栏'} onClick={toggleSide}>
          <SidebarToggleIcon mirrored />
        </button>
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
            hidden={!showCaptions}
            opacity={captionOpacity}
            fontSize={captionFontSize}
            zhSize={captionZhSize}
            fontFamily={captionFontCss(captionFont)}
            weight={captionWeight}
            shadow={captionShadow}
            texture={captionTexture}
            showZh={showZh}
            zhLines={zhLines}
            knownWords={vocabWords}
            onWordSelect={openSelection}
            onWordHover={hoverTranslate ? hoverWord : undefined}
            onCaptionEnter={onCaptionEnter}
            onCaptionLeave={onCaptionLeave}
          />
        </div>
        {/* 保持挂载，width 过渡到 0 实现与左侧一致的收缩动效（inner 固定为当前面板宽度防重排抖动） */}
        <div className="side-panel" style={{ width: sideCollapsed ? 0 : sideWidth }}>
          {!sideCollapsed && (
            <div className="side-resizer" title="拖拽调整宽度" onMouseDown={startSideResize} />
          )}
          <div className="side-panel-inner" style={{ width: sideWidth }}>
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
                onWordHover={hoverTranslate ? openSelection : undefined}
                showZh={showZh}
                zhLines={zhLines}
                zhLoading={zhLoading}
                onShowZhChange={toggleZh}
                knownWords={vocabWords}
                looping={looping}
                onLoopChange={setLooping}
                hasZhNative={hasZhNative}
                zhOffset={zhOffset}
                onZhOffset={adjustZhOffset}
                onExport={exportSubs}
              />
            ) : (
              <FavoritesTab />
            )}
          </div>
        </div>
      </div>
      {selection && video && (
        <TranslatePopup
          key={selection.text}
          text={selection.text}
          rect={selection.rect}
          sentence={selection.sentence}
          video={{ videoId: video.videoId, title: video.title }}
          time={time}
          savedItem={findSavedByLemma(vocabList, selection.text)}
          onClose={closeSelection}
          onEnter={() => {
            // 移入弹窗：取消悬停弹窗的关闭倒计时
            popupHoverRef.current = true
            if (hoverCloseTimerRef.current) {
              window.clearTimeout(hoverCloseTimerRef.current)
              hoverCloseTimerRef.current = null
            }
          }}
          onLeave={() => {
            popupHoverRef.current = false
            // 悬停弹窗且鼠标既不在字幕也不在弹窗上：关闭
            if (popupFromHoverRef.current && !document.querySelector('.caption-line:hover')) {
              closeSelection()
            }
          }}
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
