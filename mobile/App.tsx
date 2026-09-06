import React, { useCallback, useEffect, useState } from 'react'
import { ErrorUtils, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { BgPlayer } from './modules/bg-player'
import { setLemmatizeErrorSink } from './src/lib/lemma'

setLemmatizeErrorSink((m) => BgPlayer.log(m))

// 全局 JS 崩溃上报：把堆栈写进 logcat（release 包排查用；API 不可用时静默跳过）
try {
  ErrorUtils.setGlobalHandler((e: Error, isFatal?: boolean) => {
    try {
      BgPlayer.log(`JS-CRASH fatal=${isFatal}: ${String(e)}\n${(e.stack ?? '').slice(0, 1500)}`)
    } catch {
      /* 忽略上报失败 */
    }
  })
} catch {
  /* ErrorUtils 不可用的环境直接跳过 */
}
import BrowseScreen from './src/screens/BrowseScreen'
import CuratedScreen from './src/screens/CuratedScreen'
import VocabScreen from './src/screens/VocabScreen'
import ReviewScreen from './src/screens/ReviewScreen'
import ShadowingScreen from './src/screens/ShadowingScreen'
import { VocabItem, vocabList } from './src/lib/storage'

type Tab = 'browse' | 'curated' | 'shadowing' | 'review' | 'vocab'

const TABS: { key: Tab; label: string }[] = [
  { key: 'browse', label: '▶ 浏览' },
  { key: 'curated', label: '🧭 精选' },
  { key: 'shadowing', label: '🗣 跟读' },
  { key: 'review', label: '↻ 复习' },
  { key: 'vocab', label: '📖 生词本' }
]

function Main(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('browse')
  const [vocab, setVocab] = useState<VocabItem[]>([])
  // 精选页点卡片 → 带视频切到浏览页
  const [pendingVideo, setPendingVideo] = useState<string | null>(null)
  const insets = useSafeAreaInsets()

  const reloadVocab = useCallback((): void => {
    void vocabList().then(setVocab)
  }, [])

  useEffect(() => {
    reloadVocab()
  }, [reloadVocab])

  return (
    <View style={[styles.app, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* 浏览页保持挂载：切走再回来视频不中断 */}
      <View style={{ flex: 1, display: tab === 'browse' ? 'flex' : 'none' }}>
        <BrowseScreen
          vocab={vocab}
          onVocabChanged={reloadVocab}
          openVideoId={pendingVideo}
          onVideoHandled={() => setPendingVideo(null)}
        />
      </View>
      {tab === 'curated' && (
        <View style={{ flex: 1 }}>
          <CuratedScreen
            onOpenVideo={(id) => {
              setPendingVideo(id)
              setTab('browse')
            }}
          />
        </View>
      )}
      {tab === 'shadowing' && (
        <View style={{ flex: 1 }}>
          <ShadowingScreen vocab={vocab} />
        </View>
      )}
      {tab === 'review' && (
        <View style={{ flex: 1 }}>
          <ReviewScreen vocab={vocab} onVocabChanged={reloadVocab} />
        </View>
      )}
      {tab === 'vocab' && (
        <View style={{ flex: 1 }}>
          <VocabScreen vocab={vocab} onVocabChanged={reloadVocab} />
        </View>
      )}
      <View style={styles.tabBar}>
        {TABS.map((t) => (
          <TouchableOpacity key={t.key} style={styles.tab} onPress={() => setTab(t.key)}>
            <Text style={tab === t.key ? styles.tabActive : styles.tabText}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  )
}

export default function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <Main />
      <StatusBar style="light" />
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: '#0f0f0f' },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#171717',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#2c2c2e'
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  tabText: { color: '#888', fontSize: 13 },
  tabActive: { color: '#3ecf8e', fontSize: 13, fontWeight: '600' }
})
