import React, { useEffect, useMemo, useState } from 'react'
import { FlatList, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { CuratedVideo, CURATED_CUES_URL_BASE, loadCurated, rankCurated } from '../lib/curated'
import { capcachePut } from '../lib/capcache'
import { favList } from '../lib/storage'
import { ThemeColors, useTheme } from '../lib/theme'

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
const PAGE_SIZE = 20

function fmtDuration(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h${m}m` : `${m}m`
}

interface Props {
  /** 点卡片去浏览页播放该视频 */
  onOpenVideo: (videoId: string) => void
}

/** 精选页：按水平/标签/创作者筛选远端内容库，点开去浏览页播放 */
export default function CuratedScreen({ onOpenVideo }: Props): React.JSX.Element {
  const { dark, colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors, dark), [colors, dark])
  const [videos, setVideos] = useState<CuratedVideo[]>([])
  const [level, setLevel] = useState<string | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [creator, setCreator] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  // 已收藏视频 id：排序时沉底（挂载时加载一次）
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    void loadCurated().then(setVideos)
  }, [])
  useEffect(() => {
    void favList().then((list) => setSeenIds(new Set(list.map((f) => f.videoId))))
  }, [])
  useEffect(() => setPage(0), [level, tags, creator])

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
  const ranked = useMemo(
    () => rankCurated(filtered, { level, tags }, seenIds, new Date().toISOString().slice(0, 10)),
    [filtered, level, tags, seenIds]
  )
  const pageCount = Math.max(1, Math.ceil(ranked.length / PAGE_SIZE))
  const cur = Math.min(page, pageCount - 1)
  const items = ranked.slice(cur * PAGE_SIZE, (cur + 1) * PAGE_SIZE)

  const creators = useMemo(() => [...new Set(videos.map((v) => v.channel).filter(Boolean))], [videos])
  const allTags = useMemo(() => [...new Set(videos.flatMap((v) => v.tags))], [videos])

  /** 打开精选视频：字幕优先快照内嵌的，没有则从 R2 按需取后写本地缓存 */
  const openVideo = async (v: CuratedVideo): Promise<void> => {
    let cues = v.cues
    if ((!cues || cues.length === 0) && CURATED_CUES_URL_BASE) {
      try {
        const r = await fetch(`${CURATED_CUES_URL_BASE}${v.videoId}.json`)
        if (r.ok) cues = (await r.json()) as CuratedVideo['cues']
      } catch {
        /* 取不到就走在线抓取链路 */
      }
    }
    if (cues && cues.length > 0) {
      void capcachePut(v.videoId, { title: v.title, en: cues, zh: null }).catch(() => {})
    }
    onOpenVideo(v.videoId)
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
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} activeOpacity={0.8} onPress={() => void openVideo(item)}>
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
          </TouchableOpacity>
        )}
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
  pager: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 24, paddingVertical: 14 },
  pagerBtn: { color: c.accent, fontSize: 14 },
  pagerOff: { color: c.subtext, fontSize: 14 },
  pagerInfo: { color: c.subtext, fontSize: 13 }
})
