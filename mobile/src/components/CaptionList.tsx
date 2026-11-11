import { formatSubtitleGloss } from '../../../src/shared/subtitle-gloss'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import * as Speech from 'expo-speech'
import { Cue, findActiveCueIndex } from '../lib/captions'
import { lemmatize } from '../lib/lemma'
import { translate, TranslateResult, wordTierTag } from '../lib/translate'
import { VocabItem, vocabAdd, vocabRemove } from '../lib/storage'
import { ThemeColors, useTheme } from '../lib/theme'
import { VolumeIcon, XIcon } from './icons'

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
  /** 点词（非当前句卡片）：底部弹窗翻译 */
  onWord: (word: string, sentence: string) => void
  onSeek: (t: number) => void
  showZh: boolean
  /** 生词本（内嵌卡的加词/已加状态与移除） */
  vocab: VocabItem[]
  onVocabChanged: () => void
  /** 当前视频出处：内嵌卡收藏生词时带上 */
  videoId: string
  videoTitle: string
  /** 当前句卡片内点词展开内嵌翻译卡时回调（BrowseScreen 用来暂停视频） */
  onInlineOpen?: () => void
  /** 内嵌翻译卡手动关闭时回调（切句自动收起不触发） */
  onInlineClose?: () => void
}

/** 把一句文本渲染成可点击的单词序列 */
function WordRow({
  text,
  knownLemmas,
  savedTranslations,
  highlightStyle,
  textStyle,
  onWord
}: {
  text: string
  knownLemmas: Set<string>
  savedTranslations: ReadonlyMap<string, string>
  highlightStyle?: object
  textStyle?: object
  onWord: (word: string) => void
}): React.JSX.Element {
  return (
    <Text style={textStyle}>
      {text.split(/(\s+)/).map((part, i) => {
        if (/^\s*$/.test(part)) return <Text key={i}>{part}</Text>
        const word = cleanWord(part)
        if (!word) return <Text key={i}>{part}</Text>
        const lemma = lemmatize(word)
        const known = knownLemmas.has(lemma)
        const translation = savedTranslations.get(lemma)
        const wordEnd = part.indexOf(word) + word.length
        return (
          <Text key={i} style={[known && staticStyles.wordKnown, highlightStyle]} onPress={() => onWord(word)}>
            {part.slice(0, wordEnd)}{translation && `[${translation}]`}{part.slice(wordEnd)}
          </Text>
        )
      })}
    </Text>
  )
}

/** 内嵌翻译卡：当前句卡片里点词后原位展开（替代底部弹窗） */
function InlineWordCard({
  word,
  sentence,
  vocab,
  onVocabChanged,
  onClose,
  videoId,
  videoTitle,
  time
}: {
  word: string
  sentence: string
  vocab: VocabItem[]
  onVocabChanged: () => void
  onClose: () => void
  videoId: string
  videoTitle: string
  time: number
}): React.JSX.Element {
  const { dark, colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors, dark), [colors, dark])
  const [result, setResult] = useState<TranslateResult | null | 'loading'>('loading')
  const savedItem = vocab.find((v) => lemmatize(v.text) === lemmatize(word)) ?? null
  const tier = wordTierTag(word)

  useEffect(() => {
    let alive = true
    setResult('loading')
    void translate(word).then((r) => alive && setResult(r))
    return () => {
      alive = false
    }
  }, [word])

  const toggle = async (): Promise<void> => {
    if (savedItem) {
      await vocabRemove(savedItem.id).catch(() => {})
    } else {
      if (!result || result === 'loading') return
      await vocabAdd({
        text: lemmatize(word),
        translation: result.translation,
        phonetic: result.phonetic,
        videoId,
        videoTitle,
        timestamp: Math.floor(time),
        sentence
      }).catch(() => {})
    }
    onVocabChanged()
  }

  return (
    <View style={styles.inlineCard}>
      <View style={styles.inlineHead}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, flex: 1 }}>
          <Text style={styles.inlineWord}>{word}</Text>
          {result !== 'loading' && result?.phonetic ? (
            <Text style={styles.inlinePhonetic}>[{result.phonetic}]</Text>
          ) : null}
        </View>
        {tier && <Text style={styles.inlineTier}>{tier}</Text>}
        <TouchableOpacity onPress={() => Speech.speak(word, { language: 'en-US' })} hitSlop={6}>
          <VolumeIcon size={16} color={colors.subtext} />
        </TouchableOpacity>
        <TouchableOpacity onPress={onClose} hitSlop={6}>
          <XIcon size={15} color={colors.subtext} />
        </TouchableOpacity>
      </View>
      {result === 'loading' ? (
        <Text style={styles.inlineTrans}>翻译中…</Text>
      ) : result ? (
        <Text style={styles.inlineTrans}>{result.translation}</Text>
      ) : (
        <Text style={styles.inlineTrans}>未查到释义</Text>
      )}
      <TouchableOpacity
        style={[styles.inlineAddBtn, savedItem && styles.inlineAddBtnSaved]}
        onPress={() => void toggle()}
      >
        <Text style={styles.inlineAddText}>{savedItem ? '已在生词本（点击移除）' : '+ 加入生词本'}</Text>
      </TouchableOpacity>
    </View>
  )
}

/** 竖屏播放页下部：字幕卡片列表（当前句高亮大卡 + 内嵌翻译，其余为普通卡片） */
export default function CaptionList({
  cues,
  zhLines,
  time,
  knownLemmas,
  onWord,
  onSeek,
  showZh,
  vocab,
  onVocabChanged,
  onInlineOpen,
  onInlineClose,
  videoId,
  videoTitle
}: Props): React.JSX.Element {
  const { dark, colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors, dark), [colors, dark])
  const savedTranslations = useMemo(
    () => new Map(vocab.map((item) => [lemmatize(item.text), formatSubtitleGloss(item.translation)])),
    [vocab]
  )
  const listRef = useRef<FlatList<Cue>>(null)
  const activeIdx = useMemo(() => findActiveCueIndex(cues, time), [cues, time])
  // 当前句卡片里展开的词
  const [expanded, setExpanded] = useState<{ word: string; sentence: string } | null>(null)

  useEffect(() => {
    if (activeIdx < 0 || cues.length === 0) return
    try {
      listRef.current?.scrollToIndex({ index: activeIdx, viewPosition: 0.3, animated: true })
    } catch {
      // 布局未就绪时滚动失败可忽略，下一次 tick 会重试
    }
    setExpanded(null) // 切句自动收起内嵌翻译
  }, [activeIdx, cues.length])

  return (
    <FlatList
      ref={listRef}
      style={styles.list}
      data={cues}
      keyExtractor={(_, i) => String(i)}
      onScrollToIndexFailed={() => {}}
      renderItem={({ item, index }) => {
        const isActive = index === activeIdx
        if (isActive) {
          return (
            <View style={styles.activeCard}>
              <WordRow
                text={item.text}
                knownLemmas={knownLemmas}
                savedTranslations={savedTranslations}
                highlightStyle={styles.activeWord}
                textStyle={styles.activeEn}
                onWord={(word) => {
                  setExpanded({ word, sentence: item.text })
                  onInlineOpen?.()
                }}
              />
              {showZh && zhLines?.[index] ? <Text style={styles.activeZh}>{zhLines[index]}</Text> : null}
              {expanded && (
                <InlineWordCard
                  word={expanded.word}
                  sentence={expanded.sentence}
                  vocab={vocab}
                  onVocabChanged={onVocabChanged}
                  videoId={videoId}
                  videoTitle={videoTitle}
                  time={time}
                  onClose={() => {
                    setExpanded(null)
                    onInlineClose?.()
                  }}
                />
              )}
            </View>
          )
        }
        return (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => onSeek(item.start)}
            style={styles.card}
          >
            <WordRow
              text={item.text}
              knownLemmas={knownLemmas}
              savedTranslations={savedTranslations}
              textStyle={styles.cardEn}
              onWord={(word) => onWord(word, item.text)}
            />
            {showZh && zhLines?.[index] ? <Text style={styles.cardZh}>{zhLines[index]}</Text> : null}
          </TouchableOpacity>
        )
      }}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyText}>打开一个带字幕的视频，字幕会显示在这里</Text>
        </View>
      }
    />
  )
}

// 语义色（生词橙）两个主题通用，保持静态
const staticStyles = StyleSheet.create({
  wordKnown: { color: '#F0A35E' }
})

const makeStyles = (c: ThemeColors, dark: boolean) =>
  StyleSheet.create({
  list: { flex: 1, backgroundColor: c.bg, paddingHorizontal: 10 },
  // 普通字幕卡片
  card: {
    backgroundColor: c.card,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginTop: 8
  },
  cardEn: { color: c.text, fontSize: 14, lineHeight: 21 },
  cardZh: { color: c.subtext, fontSize: 12, lineHeight: 18, marginTop: 3 },
  // 当前句大卡：高亮背景 + 强调边框
  activeCard: {
    backgroundColor: c.activeCard,
    borderRadius: 16,
    padding: 12,
    marginTop: 10,
    borderWidth: 1,
    borderColor: 'rgba(10,132,255,0.35)',
    overflow: 'hidden'
  },
  activeEn: { color: c.text, fontSize: 16, fontWeight: '600', lineHeight: 24 },
  activeWord: { color: c.accent, fontWeight: '700' },
  activeZh: { color: c.subtext, fontSize: 13, lineHeight: 20, marginTop: 5 },
  // 内嵌翻译卡
  inlineCard: {
    backgroundColor: dark ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.05)',
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 12,
    padding: 10,
    marginTop: 10
  },
  inlineHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inlineWord: { color: c.accent, fontSize: 15, fontWeight: '700' },
  inlinePhonetic: { color: c.subtext, fontSize: 11 },
  inlineTier: {
    color: c.accent,
    fontSize: 10,
    fontWeight: '700',
    borderWidth: 1,
    borderColor: 'rgba(10,132,255,0.4)',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1
  },
  inlineTrans: { color: c.text, fontSize: 13, lineHeight: 20, marginTop: 6 },
  inlineAddBtn: {
    backgroundColor: dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
    borderRadius: 999,
    paddingVertical: 5,
    alignItems: 'center',
    marginTop: 8
  },
  inlineAddBtnSaved: { backgroundColor: 'rgba(62,207,142,0.25)' },
  inlineAddText: { color: c.text, fontSize: 12 },
  empty: { padding: 32, alignItems: 'center' },
  emptyText: { color: c.subtext, fontSize: 14 }
})
