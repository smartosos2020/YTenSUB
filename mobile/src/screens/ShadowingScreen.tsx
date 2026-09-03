import React, { useEffect, useMemo, useRef, useState } from 'react'
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import * as Speech from 'expo-speech'
import { MASTERED_LEVEL, ShadowingScript, shadowingList, VocabItem } from '../lib/storage'
import { lemmatize } from '../lib/lemma'

/** 每句预估朗读时长（秒）：按词数估算，下限 2.5s；与桌面端同规则 */
function estDuration(text: string): number {
  const words = text.trim().split(/\s+/).length
  return Math.max(2.5, words / 2.4)
}

interface Props {
  vocab: VocabItem[]
}

/** 跟读页：列表选脚本 → 提词器播放（自动滚动 + 速度调节 + 每句 TTS 示范） */
export default function ShadowingScreen({ vocab }: Props): React.JSX.Element {
  const [scripts, setScripts] = useState<ShadowingScript[]>([])
  const [script, setScript] = useState<ShadowingScript | null>(null)
  const [position, setPosition] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [voiceOn, setVoiceOn] = useState(true)
  const [showZh, setShowZh] = useState(true)
  const listRef = useRef<FlatList>(null)
  const speedRef = useRef(speed)
  speedRef.current = speed

  useEffect(() => {
    void shadowingList().then(setScripts)
  }, [])

  // 生词词元：脚本里高亮未掌握的生词
  const knownLemmas = useMemo(
    () =>
      new Set(
        vocab.filter((v) => (v.reviewLevel ?? 0) < MASTERED_LEVEL).map((v) => lemmatize(v.text))
      ),
    [vocab]
  )

  const { starts, total } = useMemo(() => {
    const items = script?.items ?? []
    const starts: number[] = []
    let acc = 0
    for (const it of items) {
      starts.push(acc)
      acc += estDuration(it.text)
    }
    return { starts, total: acc }
  }, [script])

  const currentIdx = useMemo(() => {
    const items = script?.items ?? []
    for (let i = 0; i < items.length; i++) {
      if (position < starts[i] + estDuration(items[i].text)) return i
    }
    return items.length - 1
  }, [position, starts, script])

  // 播放推进：100ms 步进，播完自动停
  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => {
      setPosition((p) => {
        const next = p + 0.1 * speedRef.current
        if (next >= total) {
          setPlaying(false)
          return total
        }
        return next
      })
    }, 100)
    return () => clearInterval(timer)
  }, [playing, total])

  // 当前句滚动到可见区
  useEffect(() => {
    if (currentIdx < 0 || !script) return
    try {
      listRef.current?.scrollToIndex({ index: currentIdx, viewPosition: 0.35, animated: true })
    } catch {
      /* 布局未就绪 */
    }
  }, [currentIdx, script])

  // 示范音：滚到新句自动朗读
  useEffect(() => {
    if (voiceOn && playing && script && currentIdx >= 0) {
      Speech.stop()
      Speech.speak(script.items[currentIdx].text, { language: 'en-US', rate: 0.95 })
    }
  }, [currentIdx, voiceOn, playing, script])

  const stop = (): void => {
    setPlaying(false)
    setPosition(0)
    Speech.stop()
  }

  if (!script) {
    return (
      <View style={styles.container}>
        <Text style={styles.header}>跟读练习</Text>
        <FlatList
          data={scripts}
          keyExtractor={(s) => s.videoId}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.scriptCard} onPress={() => setScript(item)}>
              <Text style={styles.scriptTitle} numberOfLines={2}>
                {item.title || item.videoId}
              </Text>
              <Text style={styles.scriptMeta}>
                {item.items.length} 句 ·{' '}
                {item.generatedBy === 'llm' ? 'LLM 生成' : item.generatedBy === 'raw' ? '原始字幕' : '规则生成'}
              </Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                还没有跟读脚本{'\n'}在电脑端收藏页生成后，到生词本页点"同步 → 从电脑拉取"
              </Text>
            </View>
          }
        />
      </View>
    )
  }

  const atEnd = position >= total
  const progressPct = total > 0 ? Math.min(100, (position / total) * 100) : 0

  const renderWords = (text: string): React.ReactNode =>
    text.split(/(\s+)/).map((part, i) => {
      if (/^\s*$/.test(part)) return <Text key={i}>{part}</Text>
      const w = part.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '')
      const known = w && knownLemmas.has(lemmatize(w))
      return (
        <Text key={i} style={known ? styles.wordKnown : undefined}>
          {part}
        </Text>
      )
    })

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => { stop(); setScript(null) }}>
          <Text style={styles.back}>← 返回</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {script.title}
        </Text>
      </View>
      <FlatList
        ref={listRef}
        style={styles.script}
        data={script.items}
        keyExtractor={(_, i) => String(i)}
        onScrollToIndexFailed={() => {}}
        renderItem={({ item, index }) => (
          <View>
            {item.scene !== undefined &&
              (index === 0 || item.scene !== script.items[index - 1].scene) && (
                <Text style={styles.scene}>场景 {item.scene}</Text>
              )}
            <TouchableOpacity
              onPress={() => setPosition(starts[index])}
              style={[styles.line, index === currentIdx && styles.lineActive]}
            >
              <Text style={styles.en}>{renderWords(item.text)}</Text>
              {showZh && item.zh ? <Text style={styles.zh}>{item.zh}</Text> : null}
            </TouchableOpacity>
          </View>
        )}
      />
      <View style={styles.playerBar}>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
        </View>
        <View style={styles.controls}>
          <TouchableOpacity style={styles.ctrlBtn} onPress={() => (atEnd ? setPosition(0) : null, setPlaying(!playing))}>
            <Text style={styles.ctrlText}>{playing ? '暂停' : atEnd ? '重播' : '播放'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.ctrlBtn} onPress={stop}>
            <Text style={styles.ctrlText}>停止</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.ctrlBtn}
            onPress={() => setSpeed((s) => (s >= 2 ? 0.5 : s + 0.25))}
          >
            <Text style={styles.ctrlText}>{speed.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}x</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.ctrlBtn, voiceOn && styles.ctrlOn]}
            onPress={() => setVoiceOn(!voiceOn)}
          >
            <Text style={styles.ctrlText}>示范音</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.ctrlBtn, showZh && styles.ctrlOn]}
            onPress={() => setShowZh(!showZh)}
          >
            <Text style={styles.ctrlText}>中文</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  )
}


const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f' },
  header: { color: '#e8e8e8', fontSize: 18, fontWeight: '600', padding: 14 },
  headerRow: { flexDirection: 'row', alignItems: 'center', padding: 10, gap: 10 },
  back: { color: '#3ecf8e', fontSize: 15 },
  headerTitle: { color: '#e8e8e8', fontSize: 14, flex: 1 },
  scriptCard: {
    backgroundColor: '#1c1c1e',
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 8,
    padding: 12
  },
  scriptTitle: { color: '#e8e8e8', fontSize: 15, lineHeight: 21 },
  scriptMeta: { color: '#9aa0a6', fontSize: 12, marginTop: 4 },
  empty: { padding: 32, alignItems: 'center' },
  emptyText: { color: '#666', fontSize: 13, textAlign: 'center', lineHeight: 22 },
  script: { flex: 1 },
  scene: { color: '#9aa0a6', fontSize: 12, paddingHorizontal: 14, paddingTop: 12 },
  line: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderLeftWidth: 2,
    borderLeftColor: 'transparent'
  },
  lineActive: { backgroundColor: '#1a2a24', borderLeftColor: '#3ecf8e' },
  en: { color: '#e8e8e8', fontSize: 17, lineHeight: 26 },
  zh: { color: '#9aa0a6', fontSize: 13, lineHeight: 20, marginTop: 2 },
  wordKnown: { color: '#f0a35e' },
  playerBar: {
    backgroundColor: '#171717',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#2c2c2e',
    paddingBottom: 10
  },
  progressTrack: { height: 3, backgroundColor: '#2c2c2e' },
  progressFill: { height: 3, backgroundColor: '#3ecf8e' },
  controls: { flexDirection: 'row', justifyContent: 'space-around', paddingTop: 8 },
  ctrlBtn: { paddingVertical: 8, paddingHorizontal: 12 },
  ctrlOn: { backgroundColor: '#1d4536', borderRadius: 6 },
  ctrlText: { color: '#e8e8e8', fontSize: 14 }
})
