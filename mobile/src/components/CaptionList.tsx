import React, { useEffect, useMemo, useRef } from 'react'
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Cue, findActiveCueIndex } from '../lib/captions'
import { lemmatize } from '../lib/lemma'

/** 去掉单词首尾标点，保留字母/数字/撇号（与桌面端 cleanWord 同规则） */
export function cleanWord(w: string): string {
  return w.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '')
}

/** 中文字幕按时间轴对齐到英文字幕：取英文 cue 中点落在哪条中文 cue 里 */
export function alignZh(enCues: Cue[], zhCues: Cue[]): (string | null)[] {
  return enCues.map((en) => {
    const mid = en.start + en.dur / 2
    const zi = findActiveCueIndex(zhCues, mid)
    // findActiveCueIndex 有 5 秒过期窗口，对齐时放宽：找最近的中文字幕
    if (zi >= 0) return zhCues[zi].text
    let best: number | null = null
    let bestDist = 1.5
    zhCues.forEach((z, i) => {
      const dist = Math.abs(z.start + z.dur / 2 - mid)
      if (dist < bestDist) {
        bestDist = dist
        best = i
      }
    })
    return best !== null ? zhCues[best].text : null
  })
}

interface Props {
  cues: Cue[]
  /** 与 cues 等长对齐的中文字幕 */
  zhLines: (string | null)[] | null
  time: number
  /** 生词词元集合：命中橙色高亮 */
  knownLemmas: Set<string>
  onWord: (word: string, sentence: string) => void
  onSeek: (t: number) => void
}

/** 竖屏播放页下部：滚动字幕列表（无浮层）。当前句高亮并自动滚到可见区 */
export default function CaptionList({ cues, zhLines, time, knownLemmas, onWord, onSeek }: Props): React.JSX.Element {
  const listRef = useRef<FlatList<Cue>>(null)
  const activeIdx = useMemo(() => findActiveCueIndex(cues, time), [cues, time])

  useEffect(() => {
    if (activeIdx < 0 || cues.length === 0) return
    try {
      listRef.current?.scrollToIndex({ index: activeIdx, viewPosition: 0.3, animated: true })
    } catch {
      // 布局未就绪时滚动失败可忽略，下一次 tick 会重试
    }
  }, [activeIdx, cues.length])

  const renderWords = (text: string): React.ReactNode =>
    text.split(/(\s+)/).map((part, i) => {
      if (/^\s*$/.test(part)) return <Text key={i}>{part}</Text>
      const word = cleanWord(part)
      if (!word) return <Text key={i}>{part}</Text>
      const known = knownLemmas.has(lemmatize(word))
      return (
        <Text
          key={i}
          style={known ? styles.wordKnown : styles.word}
          onPress={(e) => {
            e.stopPropagation?.()
            onWord(word, text)
          }}
        >
          {part}
        </Text>
      )
    })

  return (
    <FlatList
      ref={listRef}
      style={styles.list}
      data={cues}
      keyExtractor={(_, i) => String(i)}
      onScrollToIndexFailed={() => {}}
      renderItem={({ item, index }) => (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => onSeek(item.start)}
          style={[styles.cue, index === activeIdx && styles.cueActive]}
        >
          <Text style={styles.en}>{renderWords(item.text)}</Text>
          {zhLines?.[index] ? <Text style={styles.zh}>{zhLines[index]}</Text> : null}
        </TouchableOpacity>
      )}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyText}>打开一个带字幕的视频，字幕会显示在这里</Text>
        </View>
      }
    />
  )
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: '#0f0f0f' },
  cue: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderLeftWidth: 2,
    borderLeftColor: 'transparent'
  },
  cueActive: {
    backgroundColor: '#1a2a24',
    borderLeftColor: '#3ecf8e'
  },
  en: { color: '#e8e8e8', fontSize: 16, lineHeight: 24 },
  zh: { color: '#9aa0a6', fontSize: 13, lineHeight: 20, marginTop: 2 },
  word: { color: '#e8e8e8' },
  wordKnown: { color: '#f0a35e' },
  empty: { padding: 32, alignItems: 'center' },
  emptyText: { color: '#666', fontSize: 14 }
})
