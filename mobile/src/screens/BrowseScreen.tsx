import React, { useCallback, useMemo, useRef, useState } from 'react'
import { Animated, AppState, Easing, PanResponder, PermissionsAndroid, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { WebView, WebViewMessageEvent } from 'react-native-webview'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import Svg, { Polygon, Polyline } from 'react-native-svg'
import CaptionList, { alignZh } from '../components/CaptionList'
import TranslateSheet from '../components/TranslateSheet'
import { Cue, parseCaptionText } from '../lib/captions'
import { EXTRACT_SCRIPT, PAUSE_SCRIPT, PLAY_DIAG_SCRIPT, PLAY_SCRIPT, PROBE_SCRIPT, QUALITY_LOW_SCRIPT, QUALITY_RESTORE_SCRIPT, seekScript, VISIBILITY_SPOOF } from '../lib/extract'
import { capcacheGet, capcachePut } from '../lib/capcache'
import { lemmatize } from '../lib/lemma'
import { favList, favToggle, VocabItem } from '../lib/storage'
import { useTheme } from '../lib/theme'
import { MoonIcon, SunIcon } from '../components/icons'
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
  /** 外部请求打开的视频（精选页联动）；消费后回调清空 */
  openVideoId?: string | null
  onVideoHandled?: () => void
}

/** 竖屏浏览页：上部 WebView 播放视频，下部滚动字幕（点词翻译、点行 seek） */
export default function BrowseScreen({ vocab, onVocabChanged, openVideoId, onVideoHandled }: Props): React.JSX.Element {
  const wvRef = useRef<WebView>(null)
  const [url, setUrl] = useState(HOME)

  // 精选页联动：外部带 videoId 进来时切到该视频
  React.useEffect(() => {
    if (!openVideoId) return
    setUrl(`https://www.youtube.com/watch?v=${openVideoId}`)
    onVideoHandled?.()
  }, [openVideoId, onVideoHandled])
  const [videoId, setVideoId] = useState('')
  const [videoTitle, setVideoTitle] = useState('')
  const [videoChannel, setVideoChannel] = useState('')
  const [time, setTime] = useState(0)
  const [cues, setCues] = useState<Cue[]>([])
  const [zhLines, setZhLines] = useState<(string | null)[] | null>(null)
  const [sel, setSel] = useState<{ word: string; sentence: string } | null>(null)
  const [paused, setPaused] = useState(true)
  // 字幕区收缩：收缩后网页区占满剩余空间
  const [subsCollapsed, setSubsCollapsed] = useState(false)
  // 双语/英文切换（传给 CaptionList）
  const [showZh, setShowZh] = useState(true)
  // 当前视频是否已收藏
  const [isFav, setIsFav] = useState(false)
  const { dark, colors, toggle } = useTheme()
  // 扩缩箭头旋转动画（0=指下/展开，1=旋转180°/收起）
  const chevAnim = useRef(new Animated.Value(0)).current
  // 展开时网页/字幕各保留至少 10%；收起仍允许网页占满，重新展开恢复拖动位置。
  const playerH = useRef(new Animated.Value(240)).current
  const rootH = useRef(0)
  const barH = useRef(0)
  const expandedRatio = useRef<number | null>(null)
  const collapsedRef = useRef(false)
  const dragStartH = useRef(240)

  const expandedHeight = (): number => {
    const available = Math.max(0, rootH.current - barH.current)
    return Math.min(available * 0.9, Math.max(available * 0.1, expandedRatio.current === null ? 240 : available * expandedRatio.current))
  }
  const resizeLayout = (): void => {
    if (rootH.current <= 0 || barH.current <= 0) return
    playerH.stopAnimation()
    playerH.setValue(collapsedRef.current ? Math.max(0, rootH.current - barH.current) : expandedHeight())
  }
  const dividerPan = useMemo(() => PanResponder.create({
    // Only the middle handle owns the drag; the arrow and option buttons retain their taps.
    onMoveShouldSetPanResponder: (_, g) => rootH.current > barH.current && barH.current > 0 &&
      Math.abs(g.dy) > 4 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderGrant: () => {
      playerH.stopAnimation(value => { dragStartH.current = value })
      collapsedRef.current = false
      setSubsCollapsed(false)
    },
    onPanResponderMove: (_, g) => {
      const available = Math.max(0, rootH.current - barH.current)
      if (!available) return
      const height = Math.min(available * 0.9, Math.max(available * 0.1, dragStartH.current + g.dy))
      expandedRatio.current = height / available
      playerH.setValue(height)
    },
    onPanResponderTerminationRequest: () => false
  }), [playerH])
  const lastExtractRef = useRef('')
  // 后台续播状态：用户在前台主动暂停过则为 true；play 注入限流
  const userPausedRef = useRef(true)
  const lastPlayInjectRef = useRef(0)

  // BgPlayer.update 在服务未就绪时返回 false：500ms 后补一次，只补一次不循环
  const updateBg = (playing: boolean, title: string): void => {
    if (!BgPlayer.update(playing, title)) {
      setTimeout(() => BgPlayer.update(playing, title), 500)
    }
  }

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
      updateBg(!pausedRef.current, titleRef.current)
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
    if (videoId) updateBg(!paused, videoTitle)
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

  // 扩缩箭头：收起时旋转 180°，200ms 过渡
  React.useEffect(() => {
    Animated.timing(chevAnim, { toValue: subsCollapsed ? 1 : 0, duration: 200, useNativeDriver: true }).start()
  }, [subsCollapsed, chevAnim])
  const chevSpin = chevAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] })

  /** 字幕区扩缩：player 高度 250ms 缓出动画（开始快收尾慢）；布局未量到时不做动画 */
  const toggleSubs = (): void => {
    const next = !collapsedRef.current
    collapsedRef.current = next
    setSubsCollapsed(next)
    if (rootH.current > 0 && barH.current > 0) {
      Animated.timing(playerH, {
        toValue: next ? Math.max(0, rootH.current - barH.current) : expandedHeight(),
        duration: 250,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false
      }).start()
    } else {
      playerH.setValue(240)
    }
  }

  // 双语/英文分段滑块位置动画
  const [segW, setSegW] = useState(0)
  const segAnim = useRef(new Animated.Value(0)).current
  React.useEffect(() => {
    Animated.timing(segAnim, { toValue: showZh ? 0 : 1, duration: 220, useNativeDriver: true }).start()
  }, [showZh, segAnim])
  // 容器 padding 2 无 border：选项/滑块宽 = (外宽 - 4)/2；onLayout 量到前兜底 26 防首帧塌陷
  const segItemW = segW > 0 ? (segW - 4) / 2 : 26

  // 换视频时查一次是否已收藏
  React.useEffect(() => {
    if (!videoId) {
      setIsFav(false)
      return
    }
    let alive = true
    void favList().then((list) => {
      if (alive) setIsFav(list.some((f) => f.videoId === videoId))
    })
    return () => {
      alive = false
    }
  }, [videoId])

  /** 悬浮星标：收藏/取消收藏当前视频 */
  const onFavPress = (): void => {
    if (!videoId) return
    void favToggle({ videoId, title: videoTitle, channel: videoChannel }).then(setIsFav)
  }

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
    setVideoChannel(p.channel ?? '')
    // 写入本地字幕缓存：下次打开同视频秒出（空字幕不写，留给下次重试）
    void capcachePut(p.videoId, {
      title: p.title ?? '',
      en,
      zh: zh.length > 0 ? zh : null
    }).catch(() => {})
  }, [])

  const onMessage = useCallback(
    (e: WebViewMessageEvent): void => {
      let msg: { kind?: string; videoId?: string; time?: number; duration?: number; paused?: boolean; payload?: Parameters<typeof handleExtract>[0] }
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
          if (__DEV__) console.log('[bg-tick]', JSON.stringify({ t: msg.time, paused: msg.paused }))
          // 后台续播：YouTube 在息屏/切后台时会自行暂停，这里顶回去；
          // 用户在前台主动暂停过的不顶（尊重用户意愿）
          if (msg.paused && !userPausedRef.current) {
            const now = Date.now()
            if (now - lastPlayInjectRef.current > 800) {
              lastPlayInjectRef.current = now
              if (__DEV__) console.log('[bg-resume] inject play')
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
          setVideoChannel('') // 新视频的频道名等提取回调回填
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
        // Google 登录完成回到 YouTube 时同步受控 source；否则切换 UA 可能重新加载旧的
        // accounts.google.com 地址，表现为验证完成后又跳回登录页。
        setUrl(req.url)
        setUa(DESKTOP_UA)
        return false
      }
      return true
    },
    [ua]
  )

  const savedItem = sel
    ? (vocab.find((v) => lemmatize(v.text) === lemmatize(sel.word)) ?? null)
    : null

  return (
    <View
      style={[styles.container, { backgroundColor: colors.bg }]}
      onLayout={(e) => {
        rootH.current = e.nativeEvent.layout.height
        resizeLayout()
      }}
    >
      {/* 顶部区域即 WebView（用 YouTube 自带播放控件）；高度由扩缩动画驱动，期间 WebView 持续 resize 属预期 */}
      <Animated.View style={[styles.player, { height: playerH }]}>
        <WebView
          ref={wvRef}
          source={{ uri: url }}
          userAgent={ua}
          thirdPartyCookiesEnabled
          onShouldStartLoadWithRequest={onShouldStart}
          injectedJavaScriptBeforeContentLoaded={VISIBILITY_SPOOF}
          injectedJavaScript={PROBE_SCRIPT}
          onMessage={onMessage}
          mediaPlaybackRequiresUserAction={false}
          allowsFullscreenVideo
          javaScriptEnabled
        />
      </Animated.View>
      {/* 字幕选项栏：左=扩缩，右=日夜切换 + 双语/英文 */}
      <View
        style={[styles.optBar, { backgroundColor: colors.bar, borderBottomColor: colors.border }]}
        onLayout={(e) => {
          barH.current = e.nativeEvent.layout.height
          resizeLayout()
        }}
      >
        <TouchableOpacity accessibilityLabel={subsCollapsed ? '展开字幕' : '收起字幕'} onPress={toggleSubs} activeOpacity={0.7} hitSlop={8} style={styles.chevBtn}>
          <Animated.View style={{ transform: [{ rotate: chevSpin }] }}>
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={colors.subtext} strokeWidth={2}>
              <Polyline points="6 9 12 15 18 9" strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </Animated.View>
        </TouchableOpacity>
        <View pointerEvents="box-none" style={styles.dragHandleLayer}>
          <View
            {...dividerPan.panHandlers}
            style={styles.dragHandle}
            accessibilityLabel="上下拖动调整网页和字幕高度"
          >
            <View style={[styles.dragGrip, { backgroundColor: colors.subtext }]} />
          </View>
        </View>
        <View style={styles.optRight}>
          <TouchableOpacity
            onPress={toggle}
            activeOpacity={0.8}
            style={[
              styles.themePill,
              { backgroundColor: dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)', borderColor: colors.border }
            ]}
          >
            {dark ? <MoonIcon size={15} color={colors.text} /> : <SunIcon size={15} color={colors.text} />}
          </TouchableOpacity>
          <View
            style={[
              styles.seg,
              { backgroundColor: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }
            ]}
            onLayout={(e) => setSegW(e.nativeEvent.layout.width)}
          >
            <Animated.View
              style={[
                styles.segSlider,
                {
                  width: segItemW,
                  backgroundColor: colors.accent,
                  transform: [{ translateX: Animated.multiply(segAnim, segItemW) }]
                }
              ]}
            />
            {([true, false] as const).map((zh) => {
              const on = showZh === zh
              return (
                <TouchableOpacity
                  key={zh ? 'zh' : 'en'}
                  onPress={() => setShowZh(zh)}
                  activeOpacity={0.8}
                  style={[styles.segItem, { width: segItemW }]}
                >
                  <Text style={[styles.segText, { color: on ? '#FFFFFF' : colors.subtext }, on && styles.segTextOn]}>
                    {zh ? '双' : '英'}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>
        </View>
      </View>
      {/* 字幕区常挂载：player 高度动画时字幕区被挤压/释放（overflow 隐藏） */}
      <View style={styles.subsArea}>
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
          showZh={showZh}
          vocab={vocab}
          onVocabChanged={onVocabChanged}
          videoId={videoId}
          videoTitle={videoTitle}
          onInlineOpen={() => wvRef.current?.injectJavaScript(PAUSE_SCRIPT)} // 当前句卡内点词：暂停视频
          onInlineClose={() => wvRef.current?.injectJavaScript(PLAY_SCRIPT)} // 手动关闭内嵌卡：恢复播放
        />
      </View>
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
      {/* 悬浮收藏：播放中才显示，底部导航上方；无背景无边框，只留星形 icon */}
      {videoId !== '' && (
        <TouchableOpacity style={styles.fab} activeOpacity={0.8} onPress={onFavPress}>
          <Svg width={22} height={22} viewBox="0 0 24 24">
            <Polygon
              points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
              fill={isFav ? colors.accent : 'none'}
              stroke={isFav ? colors.accent : colors.subtext}
              strokeWidth={1.9}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </TouchableOpacity>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  player: { backgroundColor: '#000', flexShrink: 0 },
  subsArea: { flex: 1, overflow: 'hidden' },
  optBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 3,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  chevBtn: { padding: 4, zIndex: 1 },
  dragHandleLayer: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  dragHandle: { width: 72, height: 26, alignItems: 'center', justifyContent: 'center' },
  dragGrip: { width: 36, height: 4, borderRadius: 2, opacity: 0.45 },
  optRight: { flexDirection: 'row', alignItems: 'center', gap: 8, zIndex: 1 },
  themePill: {
    borderRadius: 999,
    borderWidth: 1,
    height: 26,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center'
  },
  seg: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    height: 26,
    padding: 2
  },
  segSlider: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    left: 2,
    borderRadius: 999
  },
  segItem: { alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch', zIndex: 1 },
  segText: { fontSize: 12 },
  segTextOn: { fontWeight: '700' },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 76,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center'
  }
})
