import React, { useEffect, useMemo, useState } from 'react'
import { FlatList, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { CuratedVideo, loadCurated, rankCurated } from '../lib/curated'
import { capcachePut } from '../lib/capcache'

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
  const [videos, setVideos] = useState<CuratedVideo[]>([])
  const [level, setLevel] = useState<string | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [creator, setCreator] = useState<string | null>(null)
  const [page, setPage] = useState(0)

  useEffect(() => {
    void loadCurated().then(setVideos)
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
    () => rankCurated(filtered, { level, tags }, new Set(), new Date().toISOString().slice(0, 10)),
    [filtered, level, tags]
  )
  const pageCount = Math.max(1, Math.ceil(ranked.length / PAGE_SIZE))
  const cur = Math.min(page, pageCount - 1)
  const items = ranked.slice(cur * PAGE_SIZE, (cur + 1) * PAGE_SIZE)

  const creators = useMemo(() => [...new Set(videos.map((v) => v.channel).filter(Boolean))], [videos])
  const allTags = useMemo(() => [...new Set(videos.flatMap((v) => v.tags))], [videos])

  /** 打开精选视频：快照带字幕就先写本地缓存，浏览页直接命中（限流也秒出） */
  const openVideo = (v: CuratedVideo): void => {
    if (v.cues && v.cues.length > 0) {
      void capcachePut(v.videoId, { title: v.title, en: v.cues, zh: null }).catch(() => {})
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
        ListEmptyComponent={
          <Text style={styles.empty}>{videos.length === 0 ? '内容库加载中或为空（稍后再试）' : '没有匹配的精选，放宽筛选试试'}</Text>
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} activeOpacity={0.8} onPress={() => openVideo(item)}>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f' },
  header: { color: '#e8e8e8', fontSize: 18, fontWeight: '600', padding: 14, paddingBottom: 4 },
  segRow: { flexGrow: 0, paddingHorizontal: 10, marginBottom: 4 },
  seg: { backgroundColor: '#1c1c1e', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginHorizontal: 2 },
  segOn: { backgroundColor: '#1d4536', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginHorizontal: 2 },
  segText: { color: '#e8e8e8', fontSize: 12 },
  empty: { color: '#666', textAlign: 'center', marginTop: 40, fontSize: 13 },
  card: { backgroundColor: '#1c1c1e', marginHorizontal: 12, marginBottom: 10, borderRadius: 8, overflow: 'hidden' },
  thumb: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' },
  badgeLv: {
    position: 'absolute', top: 6, left: 6,
    backgroundColor: '#3ecf8e', color: '#fff', fontSize: 11,
    paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, overflow: 'hidden'
  },
  badgeDur: {
    position: 'absolute', top: 6, right: 6,
    backgroundColor: '#3ecf8e', color: '#fff', fontSize: 11,
    paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, overflow: 'hidden'
  },
  title: { color: '#e8e8e8', fontSize: 14, lineHeight: 20, paddingHorizontal: 10, paddingTop: 8 },
  channel: { color: '#9aa0a6', fontSize: 12, flex: 1, marginRight: 8 },
  pager: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 24, paddingVertical: 14 },
  pagerBtn: { color: '#3ecf8e', fontSize: 14 },
  pagerOff: { color: '#555', fontSize: 14 },
  pagerInfo: { color: '#9aa0a6', fontSize: 13 }
})
