import React, { useCallback, useMemo, useRef, useState } from 'react'
import { AppState, PermissionsAndroid, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { WebView, WebViewMessageEvent } from 'react-native-webview'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import CaptionList, { alignZh } from '../components/CaptionList'
import TranslateSheet from '../components/TranslateSheet'
import { Cue, parseCaptionText } from '../lib/captions'
import { EXTRACT_SCRIPT, PAUSE_SCRIPT, PLAY_DIAG_SCRIPT, PLAY_SCRIPT, PROBE_SCRIPT, QUALITY_LOW_SCRIPT, QUALITY_RESTORE_SCRIPT, seekScript, VISIBILITY_SPOOF } from '../lib/extract'
import { capcacheGet, capcachePut } from '../lib/capcache'
import { lemmatize } from '../lib/lemma'
import { VocabItem } from '../lib/storage'
import { BgPlayer, onMediaAction } from '../../modules/bg-player'

const HOME = 'https://www.youtube.com'
// 桌面 UA：拿桌面版 watch 页面，行为与桌面端提取链路一致
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
// Google 登录页专用 UA：普通安卓版 Chrome（无 wv 标记）。Google 会拒绝内嵌 WebView 特征的
// UA 登录（"浏览器不被信任"），只有进入 accounts.google.com 时临时切换，登录完成切回桌面 UA
const GOOGLE_UA =
  'Mozilla/5.0 (Linux; Android 14; PJX110) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.71 Mobile Safari/537.36'

interface Props {
  vocab: VocabItem[]
  onVocabChanged: () => void
}

/** 竖屏浏览页：上部 WebView 播放视频，下部滚动字幕（点词翻译、点行 seek） */
export default function BrowseScreen({ vocab, onVocabChanged }: Props): React.JSX.Element {
  const wvRef = useRef<WebView>(null)
  const [url, setUrl] = useState(HOME)
  const [videoId, setVideoId] = useState('')
  const [videoTitle, setVideoTitle] = useState('')
  const [time, setTime] = useState(0)
  const [cues, setCues] = useState<Cue[]>([])
  const [zhLines, setZhLines] = useState<(string | null)[] | null>(null)
  const [sel, setSel] = useState<{ word: string; sentence: string } | null>(null)
  const [paused, setPaused] = useState(true)
  // 字幕区收缩：收缩后网页区占满剩余空间
  const [subsCollapsed, setSubsCollapsed] = useState(false)
  const lastExtractRef = useRef('')
  // 后台续播状态：用户在前台主动暂停过则为 true；play 注入限流
  const userPausedRef = useRef(true)
  const lastPlayInjectRef = useRef(0)

  // 实验：播放中保持亮屏（息屏播放的前置验证——先看长播放时音频流是否稳定）
  React.useEffect(() => {
    if (!paused && videoId) void activateKeepAwakeAsync('player')
    else void deactivateKeepAwake('player')
    return () => {
      void deactivateKeepAwake('player')
    }
  }, [paused, videoId])

  // 后台播放：有视频即拉起前台服务（媒体卡片）；暂停不杀服务（通知可恢复播放），
  // 唤醒锁随播放状态在服务内收放。通知/锁屏的播放键经 onMediaAction 驱动 WebView
  const notifPermAsked = useRef(false)
  React.useEffect(() => {
    if (!videoId) {
      BgPlayer.stop()
      return
    }
    const start = (): void => {
      BgPlayer.start()
      BgPlayer.update(!pausedRef.current, titleRef.current)
    }
    // Android 13+ 前台服务通知需要运行时权限，只在首次播放时请求
    if (!notifPermAsked.current && Platform.OS === 'android' && Platform.Version >= 33) {
      notifPermAsked.current = true
      void PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS' as never).finally(start)
    } else {
      start()
    }
    return () => {
      BgPlayer.stop()
    }
  }, [videoId])

  // 播放状态/标题同步到媒体卡片（依赖 ref 镜像避免 effect 连锁）
  const pausedRef = useRef(true)
  const titleRef = useRef('')
  pausedRef.current = paused
  titleRef.current = videoTitle
  React.useEffect(() => {
    if (videoId) BgPlayer.update(!paused, videoTitle)
  }, [paused, videoTitle, videoId])

  // 后台降画质：进后台/息屏时压到 144p（省视频流流量），回前台恢复原清晰度
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      wvRef.current?.injectJavaScript(s === 'active' ? QUALITY_RESTORE_SCRIPT : QUALITY_LOW_SCRIPT)
    })
    return () => sub.remove()
  }, [])

  // 媒体卡片/锁屏按钮：原生侧走音频焦点通道直接控制 WebView（后台页面 JS 冻结，注入无效）。
  // 这里只同步"用户主动暂停"标记，让息屏自动续播不顶回
  React.useEffect(
    () =>
      onMediaAction((action) => {
        BgPlayer.log('js-received ' + action + ' appState=' + AppState.currentState)
        userPausedRef.current = action === 'pause'
      }),
    []
  )

  /** 生词词元集合：字幕高亮 + 弹窗"已收藏"判断 */
  const knownLemmas = useMemo(() => new Set(vocab.map((v) => lemmatize(v.text))), [vocab])

  /** 抓取字幕正文（RN 侧全局 fetch，无 cookie 无浏览器指纹），失败静默 */
  const fetchText = async (u: string | null): Promise<string | null> => {
    if (!u) return null
    try {
      const r = await fetch(u)
      const t = await r.text()
      return t || null
    } catch {
      return null
    }
  }

  const handleExtract = useCallback(async (p: {
    ok: boolean
    videoId?: string
    title?: string
    channel?: string
    hasCaptions?: boolean
    enBaseUrl?: string | null
    zhBaseUrl?: string | null
  }): Promise<void> => {
    if (!p.ok || !p.videoId) {
      setCues([])
      setZhLines(null)
      return
    }
    let zhUrl = p.zhBaseUrl ?? null
    if (!zhUrl && p.enBaseUrl) {
      const u = new URL(p.enBaseUrl)
      u.searchParams.set('tlang', 'zh-Hans') // 无自带中文轨时用 YouTube 机翻轨
      zhUrl = u.toString()
    }
    const [enText, zhText] = await Promise.all([fetchText(p.enBaseUrl ?? null), fetchText(zhUrl)])
    const en = parseCaptionText(enText)
    const zh = parseCaptionText(zhText)
    setCues(en)
    setZhLines(en.length && zh.length ? alignZh(en, zh) : null)
    setVideoTitle(p.title ?? '')
    // 写入本地字幕缓存：下次打开同视频秒出（空字幕不写，留给下次重试）
    void capcachePut(p.videoId, {
      title: p.title ?? '',
      en,
      zh: zh.length > 0 ? zh : null
    }).catch(() => {})
  }, [])

  const onMessage = useCallback(
    (e: WebViewMessageEvent): void => {
      let msg: { kind?: string; videoId?: string; time?: number; paused?: boolean; payload?: Parameters<typeof handleExtract>[0] }
      try {
        msg = JSON.parse(e.nativeEvent.data)
      } catch {
        return
      }
      if (msg.kind === 'tick') {
        setTime(msg.time ?? 0)
        setPaused(msg.paused ?? true)
        // 后台诊断：App 不在前台时把页面心跳打进 Metro 日志（息屏后 renderer 是否活着、YouTube 是否自停）
        if (AppState.currentState !== 'active') {
          console.log('[bg-tick]', JSON.stringify({ t: msg.time, paused: msg.paused }))
          // 后台续播：YouTube 在息屏/切后台时会自行暂停，这里顶回去；
          // 用户在前台主动暂停过的不顶（尊重用户意愿）
          if (msg.paused && !userPausedRef.current) {
            const now = Date.now()
            if (now - lastPlayInjectRef.current > 800) {
              lastPlayInjectRef.current = now
              console.log('[bg-resume] inject play')
              wvRef.current?.injectJavaScript(PLAY_DIAG_SCRIPT)
            }
          }
        } else {
          // 前台期间的暂停视为用户主动行为
          userPausedRef.current = msg.paused ?? true
        }
        const id = msg.videoId ?? ''
        setVideoId((prev) => (prev === id ? prev : id))
        // 换视频时触发提取（同一视频只提一次）；先查本地字幕缓存，命中即秒出
        if (id && id !== lastExtractRef.current) {
          lastExtractRef.current = id
          setCues([])
          setZhLines(null)
          void capcacheGet(id).then((hit) => {
            if (hit) {
              setCues(hit.en)
              setZhLines(hit.en.length && hit.zh?.length ? alignZh(hit.en, hit.zh) : null)
              setVideoTitle(hit.title)
            } else {
              wvRef.current?.injectJavaScript(EXTRACT_SCRIPT)
            }
          })
        }
      } else if (msg.kind === 'extract' && msg.payload) {
        void handleExtract(msg.payload)
      } else if ((msg as { kind?: string }).kind === 'dbg') {
        const m = (msg as unknown as { msg?: string }).msg ?? ''
        console.log('[dbg]', m)
        BgPlayer.log('page ' + m) // 页面回执透传 logcat（release 排查用）
      }
    },
    [handleExtract]
  )

  /** 登录 UA 切换：进入 Google 登录域用安卓 Chrome UA，回到 YouTube 恢复桌面 UA */
  const [ua, setUa] = useState(DESKTOP_UA)
  const onShouldStart = useCallback(
    (req: { url: string }): boolean => {
      const isGoogleAuth = req.url.startsWith('https://accounts.google.com')
      if (isGoogleAuth && ua !== GOOGLE_UA) {
        setUa(GOOGLE_UA)
        setUrl(req.url)
        return false
      }
      if (!isGoogleAuth && ua === GOOGLE_UA && new URL(req.url).hostname.endsWith('youtube.com')) {
        setUa(DESKTOP_UA) // 回到 YouTube：恢复桌面 UA（会触发当前页重载，仅登录后一次）
      }
      return true
    },
    [ua]
  )

  const savedItem = sel
    ? (vocab.find((v) => lemmatize(v.text) === lemmatize(sel.word)) ?? null)
    : null

  return (
    <View style={styles.container}>
      {/* 顶部区域即 WebView（YouTube 页面内部导航），无地址栏 */}
      <View style={subsCollapsed ? styles.playerExpanded : styles.player}>
        <WebView
          ref={wvRef}
          source={{ uri: url }}
          userAgent={ua}
          onShouldStartLoadWithRequest={onShouldStart}
          injectedJavaScriptBeforeContentLoaded={VISIBILITY_SPOOF}
          injectedJavaScript={PROBE_SCRIPT}
          onMessage={onMessage}
          mediaPlaybackRequiresUserAction={false}
          allowsFullscreenVideo
          javaScriptEnabled
        />
      </View>
      {/* 字幕区收缩/展开开关（纯图标）：收缩后网页区占满 */}
      <TouchableOpacity
        style={styles.subsToggle}
        onPress={() => setSubsCollapsed(!subsCollapsed)}
        activeOpacity={0.7}
      >
        <Text style={styles.subsToggleText}>{subsCollapsed ? '▲' : '▼'}</Text>
      </TouchableOpacity>
      {!subsCollapsed && (
        <CaptionList
          cues={cues}
          zhLines={zhLines}
          time={time}
          knownLemmas={knownLemmas}
          onWord={(word, sentence) => {
            wvRef.current?.injectJavaScript(PAUSE_SCRIPT) // 点词暂停，关弹窗恢复
            setSel({ word, sentence })
          }}
          onSeek={(t) => wvRef.current?.injectJavaScript(seekScript(t))}
        />
      )}
      <TranslateSheet
        word={sel?.word ?? null}
        sentence={sel?.sentence ?? ''}
        videoId={videoId}
        videoTitle={videoTitle}
        time={time}
        savedItem={savedItem}
        onClose={() => {
          setSel(null)
          wvRef.current?.injectJavaScript(PLAY_SCRIPT)
        }}
        onVocabChanged={onVocabChanged}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f' },
  player: { height: 240, backgroundColor: '#000' },
  playerExpanded: { flex: 1, backgroundColor: '#000' },
  subsToggle: {
    backgroundColor: '#171717',
    paddingVertical: 8,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#2c2c2e'
  },
  subsToggleText: { color: '#9aa0a6', fontSize: 13 },
  title: {
    color: '#9aa0a6',
    fontSize: 12,
    paddingHorizontal: 14,
    paddingVertical: 6
  }
})
