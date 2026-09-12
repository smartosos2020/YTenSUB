import React, { useEffect, useMemo, useState } from 'react'
import { FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { FavoriteItem, favList } from '../lib/storage'
import { ThemeColors, useTheme } from '../lib/theme'

interface Props {
  /** 点卡片去浏览页播放该视频 */
  onOpenVideo: (videoId: string) => void
}

/** 收藏页：星标收藏的视频网格（2 列卡片），点开去浏览页播放；tab 切换重新挂载即刷新 */
export default function FavoritesScreen({ onOpenVideo }: Props): React.JSX.Element {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [items, setItems] = useState<FavoriteItem[]>([])

  useEffect(() => {
    void favList().then(setItems)
  }, [])

  return (
    <View style={styles.container}>
      <Text style={styles.header}>收藏</Text>
      <FlatList
        style={{ flex: 1 }}
        data={items}
        keyExtractor={(f) => f.videoId}
        numColumns={2}
        columnWrapperStyle={styles.row}
        ListEmptyComponent={
          <Text style={styles.empty}>还没有收藏，浏览视频时点右下角星标</Text>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            activeOpacity={0.8}
            onPress={() => onOpenVideo(item.videoId)}
          >
            <Image
              source={{ uri: `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg` }}
              style={styles.thumb}
            />
            <Text style={styles.title} numberOfLines={2}>
              {item.title || item.videoId}
            </Text>
            <Text style={styles.channel} numberOfLines={1}>
              {item.channel}
            </Text>
          </TouchableOpacity>
        )}
      />
    </View>
  )
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    header: { color: c.text, fontSize: 18, fontWeight: '600', padding: 14, paddingBottom: 4 },
    empty: { color: c.subtext, textAlign: 'center', marginTop: 40, fontSize: 13 },
    row: { paddingHorizontal: 12, gap: 8 },
    card: {
      flex: 1,
      backgroundColor: c.card,
      marginBottom: 10,
      borderRadius: 8,
      overflow: 'hidden'
    },
    thumb: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' },
    title: { color: c.text, fontSize: 12, lineHeight: 17, paddingHorizontal: 8, paddingTop: 6 },
    channel: { color: c.subtext, fontSize: 11, paddingHorizontal: 8, paddingBottom: 8, paddingTop: 2 }
  })
