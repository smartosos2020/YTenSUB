import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { CuratedVideo, loadCurated, rankCurated, refreshCurated } from '../lib/curated'
import { capcachePut } from '../lib/capcache'
import { favList } from '../lib/storage'
import { ThemeColors, useTheme } from '../lib/theme'
import {
  authCache,
  CuratedPrefs,
  fetchEntitlement,
  fetchFilterSensitive,
  fetchProCues,
  loadPrefsCache,
  loadSession,
  Plan,
  putPrefs,
  savePrefsCache
} from '../lib/auth'
import {
  cacheEntitlement,
  effectiveCachedPlan,
  FREE_DAILY_QUOTA,
  isPaidPlan,
  loadEntitlementCache,
  saveEntitlementCache
} from '../lib/entitlement'
import { LockIcon, RefreshIcon } from '../components/icons'
import PaywallSheet from '../components/PaywallSheet'
import { filterSensitiveVideos } from '../lib/sensitive'
import {
  CuratedFeedback,
  emptyFeedback,
  loadFeedback,
  markNotInterestedChannel,
  markNotInterestedVideo,
  markWatched,
  saveFeedback
} from '../lib/curated-feedback'

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
const PAGE_SIZE = 20

function fmtDuration(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h${m}m` : `${m}m`
}

interface Props {
  /** 是否正在显示，用于切回精选时刷新权益等轻量状态 */
  isActive: boolean
  /** 点卡片去浏览页播放该视频 */
  onOpenVideo: (videoId: string) => void
  /** 付费墙主按钮：切到「我的」tab */
  onGoMy: () => void
}

/** 精选页：按水平/标签/创作者筛选远端内容库，点开去浏览页播放；免费档每天前 3 部，第 4 部起锁定出付费墙 */
export default function CuratedScreen({ isActive, onOpenVideo, onGoMy }: Props): React.JSX.Element {
  const { dark, colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors, dark), [colors, dark])
  const [videos, setVideos] = useState<CuratedVideo[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [level, setLevel] = useState<string | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [creator, setCreator] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  // 已收藏视频 id：排序时沉底（进入精选页时刷新）
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set())
  // 当前档位：默认 free（fail closed），进入精选页时在线求证后按缓存+宽限期重定
  const [plan, setPlan] = useState<Plan>('free')
  const [paywallOpen, setPaywallOpen] = useState(false)
  // 敏感过滤开关：用户级（权益字段，服务端解析：用户覆盖 > 全局）> 全局公共开关；默认开
  const [filterOn, setFilterOn] = useState(true)
  // 推荐反馈（⑨）：不感兴趣隐藏/频道沉底/已看完沉底；挂载时读本地，操作即写
  const [feedback, setFeedback] = useState<CuratedFeedback>(emptyFeedback())
  // 偏好缓存加载完成后才允许变更防抖上传（避免把初始空值传上去）
  const prefsReady = useRef(false)
  const paid = isPaidPlan(plan)

  useEffect(() => {
    let active = true
    void loadCurated((cached) => {
      if (active) setVideos(cached)
    }).then((loaded) => {
      if (active) setVideos(loaded)
    })
    return () => {
      active = false
    }
  }, [])
  useEffect(() => {
    if (!isActive) return
    let active = true
    void favList().then((list) => {
      if (active) setSeenIds(new Set(list.map((f) => f.videoId)))
    })
    return () => {
      active = false
    }
  }, [isActive])
  // 读推荐反馈（本地持久化，不上云）
  useEffect(() => {
    void loadFeedback().then(setFeedback)
  }, [])
  useEffect(() => setPage(0), [level, tags, creator])

  const refreshList = async (): Promise<void> => {
    if (refreshing) return
    setRefreshing(true)
    try {
      const result = await refreshCurated((cached) => setVideos(cached))
      setVideos(result.videos)
      if (!result.updated) {
        Alert.alert('刷新失败', '网络暂不可用，已保留本地精选内容。')
      }
    } catch {
      Alert.alert('刷新失败', '已保留当前精选内容，请检查网络后重试。')
    } finally {
      setRefreshing(false)
    }
  }

  // 进入精选页：有会话先在线拉权益（成功写缓存），再按缓存+宽限期定档位（D5）；失败静默走缓存
  // 敏感过滤开关三级解析（复用本次 fetchEntitlement，不多发请求）：
  // 本地权益缓存的用户级字段（离线宽限期内直接用）→ 在线求证覆盖 → 未登录/失败回退全局公共开关 → 都失败按开
  useEffect(() => {
    if (!isActive) return
    void (async () => {
      const s = authCache.session ?? (await loadSession())
      const cached = await loadEntitlementCache()
      /** 回退全局公共开关；再失败按开（fail closed，合规优先） */
      const fallbackGlobal = async (): Promise<void> => {
        try {
          const r = await fetchFilterSensitive()
          setFilterOn(r.on)
        } catch {
          setFilterOn(true)
        }
      }
      if (s) {
        // 旧缓存可能没有 filterSensitive 字段，有才先用
        if (cached?.filterSensitive !== undefined) setFilterOn(cached.filterSensitive)
        try {
          const r = await fetchEntitlement(s.token)
          authCache.entitlement = r.entitlement
          await saveEntitlementCache(cacheEntitlement(r.entitlement, Date.now()))
          // 服务端已解析（用户级覆盖 > 全局开关）；字段缺省按 true
          setFilterOn(r.entitlement.filterSensitive ?? true)
        } catch {
          // 在线求证失败且缓存无用户级字段：回退全局公共开关
          if (cached?.filterSensitive === undefined) await fallbackGlobal()
        }
      } else {
        // 未登录：直接走全局公共开关
        await fallbackGlobal()
      }
      setPlan(effectiveCachedPlan(await loadEntitlementCache(), Date.now()))
    })()
  }, [isActive])

  // 进入精选页时读本地偏好缓存应用到筛选（服务器偏好已在登录/启动预热时写入本地，服务器为准）
  useEffect(() => {
    if (!isActive) return
    prefsReady.current = false
    void loadPrefsCache().then((p) => {
      if (p) {
        setLevel(p.curatedLevel)
        setTags(p.curatedTags)
      }
      prefsReady.current = true
    })
  }, [isActive])

  // 偏好随账号同步（付费档）：本地变更防抖 1s 上传（先落本地缓存），失败静默
  useEffect(() => {
    if (!prefsReady.current) return
    const t = setTimeout(() => {
      void (async () => {
        const s = authCache.session ?? (await loadSession())
        if (!s) return
        const ent = await loadEntitlementCache()
        if (!isPaidPlan(effectiveCachedPlan(ent, Date.now()))) return
        const prefs: CuratedPrefs = { curatedLevel: level, curatedTags: tags, updatedAt: Date.now() }
        await savePrefsCache(prefs)
        try {
          await putPrefs(s.token, prefs)
        } catch {
          /* 上传失败静默，本地已存 */
        }
      })()
    }, 1000)
    return () => clearTimeout(t)
  }, [level, tags])

  const filtered = useMemo(
    () =>
      videos.filter((v) => {
        if (creator && v.channel !== creator) return false
        if (level && v.level !== level) return false
        if (tags.length > 0 && !tags.some((t) => v.tags.includes(t))) return false
        return true
      }),
    [videos, creator, level, tags]
  )
  // 敏感话题过滤在 rankCurated 之前套：免费档"前 3 部"的锁定序号按过滤后的列表算
  const visible = useMemo(() => filterSensitiveVideos(filtered, filterOn), [filtered, filterOn])
  const ranked = useMemo(
    () => rankCurated(visible, { level, tags }, seenIds, new Date().toISOString().slice(0, 10), feedback),
    [visible, level, tags, seenIds, feedback]
  )
  const pageCount = Math.max(1, Math.ceil(ranked.length / PAGE_SIZE))
  const cur = Math.min(page, pageCount - 1)
  const items = ranked.slice(cur * PAGE_SIZE, (cur + 1) * PAGE_SIZE)

  const creators = useMemo(() => [...new Set(videos.map((v) => v.channel).filter(Boolean))], [videos])
  const allTags = useMemo(() => [...new Set(videos.flatMap((v) => v.tags))], [videos])

  /** 优先使用本地字幕；pro+ 从 Worker 鉴权下载，其余情况走 YouTube 抓取。 */
  const openVideo = async (v: CuratedVideo): Promise<void> => {
    let cues = v.cues
    if ((!cues || cues.length === 0) && authCache.session && plan === 'pro_plus') {
      try {
        const proCues = await fetchProCues(authCache.session.token, v.videoId)
        if (proCues.length > 0) cues = proCues
      } catch {
        /* 在线字幕抓取由播放器继续处理。 */
      }
    }
    if (cues && cues.length > 0) {
      void capcachePut(v.videoId, { title: v.title, en: cues, zh: null }).catch(() => {})
    }
    onOpenVideo(v.videoId)
  }

  /** 应用一条反馈：函数式更新 state 重排 + 写本地存储 */
  const applyFeedback = (fn: (fb: CuratedFeedback) => CuratedFeedback): void => {
    setFeedback((cur) => {
      const next = fn(cur)
      void saveFeedback(next)
      return next
    })
  }

  /** 长按卡片的反馈菜单：不感兴趣隐藏 / 频道沉底 / 已看完沉底 */
  const showFeedbackMenu = (v: CuratedVideo): void => {
    Alert.alert(v.title || v.videoId, undefined, [
      { text: '不感兴趣这个视频', onPress: () => applyFeedback((fb) => markNotInterestedVideo(fb, v.videoId)) },
      { text: '不再推荐此频道', onPress: () => applyFeedback((fb) => markNotInterestedChannel(fb, v.channelId)) },
      { text: '标记已看完', onPress: () => applyFeedback((fb) => markWatched(fb, v.videoId)) },
      { text: '取消', style: 'cancel' }
    ])
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header}>精选</Text>
      {/* 水平筛选 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.segRow}>
        <TouchableOpacity style={level === null ? styles.segOn : styles.seg} onPress={() => setLevel(null)}>
          <Text style={styles.segText}>不限</Text>
        </TouchableOpacity>
        {LEVELS.map((l) => (
          <TouchableOpacity key={l} style={level === l ? styles.segOn : styles.seg} onPress={() => setLevel(l)}>
            <Text style={styles.segText}>{l}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      {/* 标签筛选 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.segRow}>
        {allTags.map((t) => (
          <TouchableOpacity
            key={t}
            style={tags.includes(t) ? styles.segOn : styles.seg}
            onPress={() => setTags((cur2) => (cur2.includes(t) ? cur2.filter((x) => x !== t) : [...cur2, t]))}
          >
            <Text style={styles.segText}>{t}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      {/* 创作者筛选 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.segRow}>
        <TouchableOpacity style={creator === null ? styles.segOn : styles.seg} onPress={() => setCreator(null)}>
          <Text style={styles.segText}>全部频道</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.refreshBtn, refreshing && styles.refreshDisabled]}
          onPress={() => void refreshList()}
          disabled={refreshing}
          accessibilityRole="button"
          accessibilityLabel="刷新精选内容"
          hitSlop={8}
        >
          {refreshing ? <ActivityIndicator size="small" color={colors.accent} /> : <RefreshIcon color={colors.subtext} />}
        </TouchableOpacity>
        {creators.map((c) => (
          <TouchableOpacity key={c} style={creator === c ? styles.segOn : styles.seg} onPress={() => setCreator(c)}>
            <Text style={styles.segText} numberOfLines={1}>
              {c.length > 14 ? c.slice(0, 13) + '…' : c}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <FlatList
        style={{ flex: 1 }}
        data={items}
        keyExtractor={(v) => v.videoId}
        numColumns={2}
        columnWrapperStyle={styles.row}
        ListEmptyComponent={
          <Text style={styles.empty}>{videos.length === 0 ? '内容库加载中或为空（稍后再试）' : '没有匹配的精选，放宽筛选试试'}</Text>
        }
        renderItem={({ item, index }) => {
          // 免费档锁定判定：按 rankCurated 排序后的全局序号，前 FREE_DAILY_QUOTA 部正常，第 4 部起锁定
          const locked = !paid && cur * PAGE_SIZE + index >= FREE_DAILY_QUOTA
          return (
            <TouchableOpacity
              style={styles.card}
              activeOpacity={0.8}
              onPress={() => (locked ? setPaywallOpen(true) : void openVideo(item))}
              onLongPress={() => (locked ? setPaywallOpen(true) : showFeedbackMenu(item))}
            >
              <View>
                <Image source={{ uri: item.thumbnail }} style={styles.thumb} />
                {item.level && <Text style={styles.badgeLv}>{item.level}</Text>}
                <Text style={styles.badgeDur}>{fmtDuration(item.duration)}</Text>
              </View>
              <Text style={styles.title} numberOfLines={2}>
                {item.title}
              </Text>
              <Text style={styles.channel} numberOfLines={1}>
                {item.channel}
              </Text>
              {locked && (
                <View style={styles.lockMask}>
                  <LockIcon size={22} color="#fff" />
                  <Text style={styles.lockText}>升级解锁全部精选</Text>
                </View>
              )}
            </TouchableOpacity>
          )
        }}
        ListFooterComponent={
          pageCount > 1 ? (
            <View style={styles.pager}>
              <TouchableOpacity disabled={cur === 0} onPress={() => setPage(cur - 1)}>
                <Text style={cur === 0 ? styles.pagerOff : styles.pagerBtn}>‹ 上一页</Text>
              </TouchableOpacity>
              <Text style={styles.pagerInfo}>
                {cur + 1} / {pageCount}
              </Text>
              <TouchableOpacity disabled={cur >= pageCount - 1} onPress={() => setPage(cur + 1)}>
                <Text style={cur >= pageCount - 1 ? styles.pagerOff : styles.pagerBtn}>下一页 ›</Text>
              </TouchableOpacity>
            </View>
          ) : null
        }
      />
      <PaywallSheet
        visible={paywallOpen}
        onClose={() => setPaywallOpen(false)}
        onGoMy={() => {
          setPaywallOpen(false)
          onGoMy()
        }}
      />
    </View>
  )
}

const makeStyles = (c: ThemeColors, dark: boolean) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  header: { color: c.text, fontSize: 18, fontWeight: '600', padding: 14, paddingBottom: 4 },
  segRow: { flexGrow: 0, paddingHorizontal: 10, marginBottom: 4 },
  seg: { backgroundColor: c.card, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginHorizontal: 2 },
  segOn: {
    backgroundColor: dark ? '#1d4536' : 'rgba(0,122,255,0.15)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginHorizontal: 2
  },
  segText: { color: c.text, fontSize: 12 },
  refreshBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 4
  },
  refreshDisabled: { opacity: 0.6 },
  empty: { color: c.subtext, textAlign: 'center', marginTop: 40, fontSize: 13 },
  row: { paddingHorizontal: 12, gap: 8 },
  card: {
    flex: 1,
    backgroundColor: c.card,
    marginBottom: 10,
    borderRadius: 8,
    overflow: 'hidden'
  },
  thumb: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' },
  badgeLv: {
    position: 'absolute', top: 5, left: 5,
    backgroundColor: '#3ecf8e', color: '#fff', fontSize: 10,
    paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, overflow: 'hidden'
  },
  badgeDur: {
    position: 'absolute', top: 5, right: 5,
    backgroundColor: '#3ecf8e', color: '#fff', fontSize: 10,
    paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, overflow: 'hidden'
  },
  title: { color: c.text, fontSize: 12, lineHeight: 17, paddingHorizontal: 8, paddingTop: 6 },
  channel: { color: c.subtext, fontSize: 11, paddingHorizontal: 8, paddingBottom: 8, paddingTop: 2 },
  lockMask: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6
  },
  lockText: { color: '#fff', fontSize: 12 },
  pager: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 24, paddingVertical: 14 },
  pagerBtn: { color: c.accent, fontSize: 14 },
  pagerOff: { color: c.subtext, fontSize: 14 },
  pagerInfo: { color: c.subtext, fontSize: 13 }
})
