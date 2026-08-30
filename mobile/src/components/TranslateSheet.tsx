import React, { useEffect, useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import * as Speech from 'expo-speech'
import { lemmatize } from '../lib/lemma'
import { translate, TranslateResult } from '../lib/translate'
import { VocabItem, vocabAdd, vocabRemove } from '../lib/storage'

interface Props {
  /** 点到的单词（表面形态）；null = 关闭 */
  word: string | null
  sentence: string
  videoId: string
  videoTitle: string
  time: number
  /** 已收藏的同词元条目（有则显示删除） */
  savedItem: VocabItem | null
  onClose: () => void
  /** 收藏/删除后通知外面刷新生词本与高亮 */
  onVocabChanged: () => void
}

/** 点词翻译底部弹层：发音 + 释义 + 收藏/删除生词（收藏统一存词元） */
export default function TranslateSheet({
  word,
  sentence,
  videoId,
  videoTitle,
  time,
  savedItem,
  onClose,
  onVocabChanged
}: Props): React.JSX.Element {
  const [result, setResult] = useState<TranslateResult | null | 'loading'>('loading')
  const [done, setDone] = useState('')

  useEffect(() => {
    if (!word) return
    setResult('loading')
    setDone('')
    let alive = true
    void translate(word).then((r) => alive && setResult(r))
    return () => {
      alive = false
    }
  }, [word])

  const speak = (): void => {
    if (word) Speech.speak(word, { language: 'en-US' })
  }

  const save = async (): Promise<void> => {
    if (!word || !result || result === 'loading') return
    await vocabAdd({
      text: lemmatize(word),
      translation: result.translation,
      phonetic: result.phonetic,
      videoId,
      videoTitle,
      timestamp: Math.floor(time),
      sentence
    })
    setDone('已收藏')
    onVocabChanged()
  }

  const remove = async (): Promise<void> => {
    if (!savedItem) return
    await vocabRemove(savedItem.id)
    setDone('已删除')
    onVocabChanged()
  }

  return (
    <Modal visible={word !== null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.mask} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.head}>
            <Text style={styles.word}>{word}</Text>
            <TouchableOpacity onPress={speak} style={styles.speakBtn}>
              <Text style={styles.speakText}>🔊 发音</Text>
            </TouchableOpacity>
          </View>
          {result === 'loading' ? (
            <Text style={styles.loading}>翻译中…</Text>
          ) : result ? (
            <>
              {result.phonetic ? <Text style={styles.phonetic}>[{result.phonetic}]</Text> : null}
              <Text style={styles.translation}>{result.translation}</Text>
              <Text style={styles.source}>
                {result.source === 'local' ? '本地词典' : 'Google 翻译'}
                {word && lemmatize(word) !== word.trim().toLowerCase()
                  ? ` · 词元 ${lemmatize(word)}`
                  : ''}
              </Text>
            </>
          ) : (
            <Text style={styles.loading}>未查到释义</Text>
          )}
          <View style={styles.actions}>
            {done ? (
              <Text style={styles.done}>{done}</Text>
            ) : savedItem ? (
              <TouchableOpacity style={[styles.btn, styles.btnDanger]} onPress={() => void remove()}>
                <Text style={styles.btnText}>删除生词</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.btn, result === 'loading' || !result ? styles.btnDisabled : null]}
                onPress={() => void save()}
              >
                <Text style={styles.btnText}>收藏生词</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={onClose}>
              <Text style={styles.btnText}>关闭</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  mask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#1c1c1e',
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    padding: 18,
    paddingBottom: 28
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  word: { color: '#fff', fontSize: 22, fontWeight: '600' },
  speakBtn: { padding: 6 },
  speakText: { color: '#3ecf8e', fontSize: 15 },
  loading: { color: '#888', marginTop: 12 },
  phonetic: { color: '#9aa0a6', marginTop: 8 },
  translation: { color: '#e8e8e8', fontSize: 16, lineHeight: 24, marginTop: 8 },
  source: { color: '#666', fontSize: 12, marginTop: 8 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  btn: {
    flex: 1,
    backgroundColor: '#2c2c2e',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center'
  },
  btnDanger: { backgroundColor: '#4a2424' },
  btnGhost: { backgroundColor: 'transparent' },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: '#e8e8e8', fontSize: 15 },
  done: { color: '#3ecf8e', fontSize: 15, flex: 1, textAlign: 'center', alignSelf: 'center' }
})
