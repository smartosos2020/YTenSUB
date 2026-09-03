import React, { useEffect, useRef, useState } from 'react'
import { Animated, PanResponder, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import * as Speech from 'expo-speech'
import { MASTERED_LEVEL, VocabItem, vocabReview } from '../lib/storage'

function isDue(v: VocabItem, now: number): boolean {
  return v.reviewDue === undefined || v.reviewDue <= now
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const GRADE_THRESHOLD = 80

interface Props {
  vocab: VocabItem[]
  onVocabChanged: () => void
}

/** 复习页：卡片式间隔重复。右滑=认识（升级），左滑=不认识（回 0 级，10 分钟后再见） */
export default function ReviewScreen({ vocab, onVocabChanged }: Props): React.JSX.Element {
  const [queue, setQueue] = useState<VocabItem[] | null>(null)
  const [total, setTotal] = useState(0)
  const [revealed, setRevealed] = useState(true)
  const dragX = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const now = Date.now()
    const due = shuffle(vocab.filter((v) => isDue(v, now)))
    setQueue(due)
    setTotal(due.length)
  }, [vocab])

  const item = queue?.[0]

  const grade = (known: boolean): void => {
    if (!item) return
    const level = known ? Math.min((item.reviewLevel ?? -1) + 1, MASTERED_LEVEL) : 0
    void vocabReview(item.id, level).then(onVocabChanged)
    setQueue((q) => (q ?? []).slice(1))
  }

  const gradeRef = useRef(grade)
  gradeRef.current = grade

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: (_, g) => dragX.setValue(g.dx),
      onPanResponderRelease: (_, g) => {
        if (g.dx <= -GRADE_THRESHOLD) gradeRef.current(false)
        else if (g.dx >= GRADE_THRESHOLD) gradeRef.current(true)
        Animated.spring(dragX, { toValue: 0, useNativeDriver: true }).start()
      },
      onPanResponderTerminate: () => {
        Animated.spring(dragX, { toValue: 0, useNativeDriver: true }).start()
      }
    })
  ).current

  if (queue === null) return <View style={styles.container} />
  if (queue.length === 0 || !item) {
    return (
      <View style={styles.container}>
        <Text style={styles.header}>复习</Text>
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            {total === 0 ? '今天没有到期的生词，去看看新视频吧' : '全部复习完了'}
          </Text>
        </View>
      </View>
    )
  }

  const done = total - queue.length
  const tilt = dragX.interpolate({ inputRange: [-150, 150], outputRange: ['-8deg', '8deg'] })
  const tintColor = dragX.interpolate({
    inputRange: [-GRADE_THRESHOLD, 0, GRADE_THRESHOLD],
    outputRange: ['rgba(224,82,82,0.25)', 'rgba(0,0,0,0)', 'rgba(62,207,142,0.25)'],
    extrapolate: 'clamp'
  })

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>复习</Text>
        <Text style={styles.progress}>
          第 {done + 1} / {total} 张
        </Text>
      </View>
      <Text style={styles.hint}>左滑不认识 · 右滑认识 · 点卡片显示/隐藏释义</Text>
      <View style={styles.center}>
        <Animated.View
          style={[styles.card, { transform: [{ translateX: dragX }, { rotate: tilt }] }]}
          {...pan.panHandlers}
        >
          <Animated.View style={[StyleSheet.absoluteFill, styles.tint, { backgroundColor: tintColor }]} />
          <TouchableOpacity activeOpacity={0.9} onPress={() => setRevealed(!revealed)}>
            <View style={styles.wordRow}>
              <Text style={styles.word}>{item.text}</Text>
              <TouchableOpacity onPress={() => Speech.speak(item.text, { language: 'en-US' })}>
                <Text style={styles.speak}>🔊</Text>
              </TouchableOpacity>
            </View>
            {item.phonetic ? <Text style={styles.phonetic}>[{item.phonetic}]</Text> : null}
            {revealed ? (
              <>
                <Text style={styles.translation}>{item.translation}</Text>
                {item.sentence ? <Text style={styles.sentence}>{item.sentence}</Text> : null}
              </>
            ) : (
              <Text style={styles.revealHint}>点卡片显示释义</Text>
            )}
          </TouchableOpacity>
        </Animated.View>
        <View style={styles.actions}>
          <TouchableOpacity style={[styles.btn, styles.btnNo]} onPress={() => grade(false)}>
            <Text style={styles.btnText}>不认识</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.btnYes]} onPress={() => grade(true)}>
            <Text style={styles.btnText}>认识</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f' },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 14
  },
  header: { color: '#e8e8e8', fontSize: 18, fontWeight: '600', padding: 14 },
  progress: { color: '#9aa0a6', fontSize: 13 },
  hint: { color: '#666', fontSize: 12, paddingHorizontal: 14, marginBottom: 8 },
  center: { flex: 1, justifyContent: 'center', paddingHorizontal: 24 },
  card: {
    backgroundColor: '#1c1c1e',
    borderRadius: 12,
    padding: 24,
    minHeight: 180,
    overflow: 'hidden'
  },
  tint: { borderRadius: 12 },
  wordRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  word: { color: '#fff', fontSize: 26, fontWeight: '600' },
  speak: { fontSize: 20, padding: 4 },
  phonetic: { color: '#9aa0a6', marginTop: 4 },
  translation: { color: '#e8e8e8', fontSize: 17, lineHeight: 26, marginTop: 14 },
  sentence: { color: '#9aa0a6', fontSize: 13, lineHeight: 20, marginTop: 10 },
  revealHint: { color: '#666', fontSize: 13, marginTop: 20, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  btn: { flex: 1, borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  btnNo: { backgroundColor: '#4a2424' },
  btnYes: { backgroundColor: '#1d4536' },
  btnText: { color: '#e8e8e8', fontSize: 15 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: '#666', fontSize: 14 }
})
