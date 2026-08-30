import React, { useCallback, useEffect, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import BrowseScreen from './src/screens/BrowseScreen'
import VocabScreen from './src/screens/VocabScreen'
import { VocabItem, vocabList } from './src/lib/storage'

type Tab = 'browse' | 'vocab'

function Main(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('browse')
  const [vocab, setVocab] = useState<VocabItem[]>([])
  const insets = useSafeAreaInsets()

  const reloadVocab = useCallback((): void => {
    void vocabList().then(setVocab)
  }, [])

  useEffect(() => {
    reloadVocab()
  }, [reloadVocab])

  return (
    <View style={[styles.app, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* 浏览页保持挂载：切到生词本再回来视频不中断 */}
      <View style={{ flex: 1, display: tab === 'browse' ? 'flex' : 'none' }}>
        <BrowseScreen vocab={vocab} onVocabChanged={reloadVocab} />
      </View>
      {tab === 'vocab' && (
        <View style={{ flex: 1 }}>
          <VocabScreen vocab={vocab} onVocabChanged={reloadVocab} />
        </View>
      )}
      <View style={styles.tabBar}>
        <TouchableOpacity style={styles.tab} onPress={() => setTab('browse')}>
          <Text style={tab === 'browse' ? styles.tabActive : styles.tabText}>▶ 浏览</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.tab} onPress={() => setTab('vocab')}>
          <Text style={tab === 'vocab' ? styles.tabActive : styles.tabText}>📖 生词本</Text>
        </TouchableOpacity>
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
  tabText: { color: '#888', fontSize: 14 },
  tabActive: { color: '#3ecf8e', fontSize: 14, fontWeight: '600' }
})
