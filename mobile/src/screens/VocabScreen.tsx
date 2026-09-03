import React from 'react'
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import * as Speech from 'expo-speech'
import { VocabItem, vocabRemove } from '../lib/storage'
import SyncSheet from '../components/SyncSheet'

interface Props {
  vocab: VocabItem[]
  onVocabChanged: () => void
}

/** 生词本：收藏的词元列表（新→旧），点喇叭发音，长按删除；右上与电脑同步 */
export default function VocabScreen({ vocab, onVocabChanged }: Props): React.JSX.Element {
  const [syncOpen, setSyncOpen] = React.useState(false)
  const confirmRemove = (item: VocabItem): void => {
    Alert.alert('删除生词', `确定删除「${item.text}」？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void vocabRemove(item.id).then(onVocabChanged)
        }
      }
    ])
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>生词本（{vocab.length}）</Text>
        <TouchableOpacity onPress={() => setSyncOpen(true)}>
          <Text style={styles.syncBtn}>⇄ 同步</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={vocab}
        keyExtractor={(v) => v.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            activeOpacity={0.7}
            onLongPress={() => confirmRemove(item)}
          >
            <View style={styles.row}>
              <Text style={styles.word}>{item.text}</Text>
              <TouchableOpacity onPress={() => Speech.speak(item.text, { language: 'en-US' })}>
                <Text style={styles.speak}>🔊</Text>
              </TouchableOpacity>
            </View>
            {item.phonetic ? <Text style={styles.phonetic}>[{item.phonetic}]</Text> : null}
            <Text style={styles.translation}>{item.translation}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>还没有生词，去看视频点词收藏吧（长按卡片可删除）</Text>
          </View>
        }
      />
      <SyncSheet visible={syncOpen} onClose={() => setSyncOpen(false)} onSynced={onVocabChanged} />
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
  header: {
    color: '#e8e8e8',
    fontSize: 18,
    fontWeight: '600',
    padding: 14
  },
  syncBtn: { color: '#3ecf8e', fontSize: 14 },
  card: {
    backgroundColor: '#1c1c1e',
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 8,
    padding: 12
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  word: { color: '#fff', fontSize: 17, fontWeight: '600' },
  speak: { fontSize: 16, padding: 4 },
  phonetic: { color: '#9aa0a6', fontSize: 12, marginTop: 2 },
  translation: { color: '#c8c8c8', fontSize: 14, lineHeight: 20, marginTop: 4 },
  empty: { padding: 32, alignItems: 'center' },
  emptyText: { color: '#666', fontSize: 14, textAlign: 'center' }
})
