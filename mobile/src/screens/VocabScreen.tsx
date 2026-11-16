import React from 'react'
import { ActivityIndicator, Alert, FlatList, Image, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import * as Speech from 'expo-speech'
import { VocabItem, vocabRemove } from '../lib/storage'
import { ThemeColors, useTheme } from '../lib/theme'
import { VolumeIcon } from '../components/icons'
import SyncSheet from '../components/SyncSheet'
import { MobileVocabVisual, vocabVisualGet } from '../lib/vocabVisual'

interface Props {
  vocab: VocabItem[]
  onVocabChanged: () => void
}

function VisualThumb({ item, styles }: { item: VocabItem; styles: ReturnType<typeof makeStyles> }): React.JSX.Element {
  const [visual, setVisual] = React.useState<MobileVocabVisual | null>(null)
  const [loading, setLoading] = React.useState(true)

  const load = React.useCallback((refresh = false): void => {
    setLoading(true)
    void vocabVisualGet(item, refresh).then(setVisual).finally(() => setLoading(false))
  }, [item])

  React.useEffect(() => load(false), [load])

  return (
    <View style={styles.visualWrap}>
      {loading ? (
        <View style={styles.visualState}><ActivityIndicator /></View>
      ) : visual?.uri ? (
        <Image source={{ uri: visual.uri }} style={styles.visualImage} resizeMode="contain" />
      ) : visual?.emoji ? (
        <Text style={styles.visualEmoji}>{visual.emoji}</Text>
      ) : (
        <View style={styles.visualState}>
          <Text style={styles.visualEmptyText}>暂无可靠配图</Text>
          <TouchableOpacity onPress={() => load(true)}><Text style={styles.visualAction}>重新匹配</Text></TouchableOpacity>
        </View>
      )}
      {visual ? (
        <View style={styles.visualMeta}>
          <TouchableOpacity
            disabled={!visual.sourceUrl}
            onPress={() => visual.sourceUrl && void Linking.openURL(visual.sourceUrl)}
          >
            <Text style={styles.visualSource} numberOfLines={1}>
              {visual.creator || (visual.source === 'noto' ? 'Noto Emoji' : visual.source === 'openverse' ? 'Openverse' : 'Wikimedia Commons')}
              {visual.license ? ` · ${visual.license}` : ''}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => load(true)}><Text style={styles.visualAction}>换一张</Text></TouchableOpacity>
        </View>
      ) : null}
    </View>
  )
}

/** 生词本：收藏的词元列表（新→旧），点喇叭发音，长按删除；右上与电脑同步 */
export default function VocabScreen({ vocab, onVocabChanged }: Props): React.JSX.Element {
  const { colors } = useTheme()
  const styles = React.useMemo(() => makeStyles(colors), [colors])
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
            <VisualThumb item={item} styles={styles} />
            <View style={styles.row}>
              <Text style={styles.word}>{item.text}</Text>
              <TouchableOpacity onPress={() => Speech.speak(item.text, { language: 'en-US' })} hitSlop={6}>
                <VolumeIcon size={18} color={colors.subtext} />
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

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 14
  },
  header: {
    color: c.text,
    fontSize: 18,
    fontWeight: '600',
    padding: 14
  },
  syncBtn: { color: c.accent, fontSize: 14 },
  card: {
    backgroundColor: c.card,
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 8,
    padding: 12
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  visualWrap: { marginBottom: 10 },
  visualImage: { width: '100%', height: 130, borderRadius: 7, backgroundColor: c.bg },
  visualEmoji: { height: 120, textAlign: 'center', textAlignVertical: 'center', fontSize: 74, backgroundColor: c.bg, borderRadius: 7 },
  visualState: { height: 84, borderRadius: 7, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  visualEmptyText: { color: c.subtext, fontSize: 11 },
  visualMeta: { minHeight: 26, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 3 },
  visualSource: { color: c.subtext, fontSize: 10, maxWidth: 250 },
  visualAction: { color: c.accent, fontSize: 11, paddingVertical: 4, paddingHorizontal: 6 },
  word: { color: c.text, fontSize: 17, fontWeight: '600' },
  phonetic: { color: c.subtext, fontSize: 12, marginTop: 2 },
  translation: { color: c.text, fontSize: 14, lineHeight: 20, marginTop: 4 },
  empty: { padding: 32, alignItems: 'center' },
  emptyText: { color: c.subtext, fontSize: 14, textAlign: 'center' }
})
