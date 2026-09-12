import React from 'react'
import { Animated, StyleSheet, TouchableOpacity, View } from 'react-native'
import Svg, { Circle, Path, Polygon, Polyline } from 'react-native-svg'
import { useTheme } from '../lib/theme'

export type DockTab = 'browse' | 'curated' | 'shadowing' | 'review' | 'vocab' | 'fav'

const TABS: { key: DockTab; label: string; icon: (color: string) => React.JSX.Element }[] = [
  {
    key: 'browse',
    label: '浏览',
    icon: (c) => (
      <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.9}>
        <Polygon points="6 4 20 12 6 20 6 4" fill={c} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    )
  },
  {
    key: 'curated',
    label: '精选',
    icon: (c) => (
      <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.9}>
        <Circle cx={12} cy={12} r={10} />
        <Polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill={c} />
      </Svg>
    )
  },
  {
    key: 'shadowing',
    label: '跟读',
    icon: (c) => (
      <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2}>
        <Path d="M3 18v-6a9 9 0 0 1 18 0v6" />
        <Path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
      </Svg>
    )
  },
  {
    key: 'review',
    label: '复习',
    icon: (c) => (
      <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.9}>
        <Polyline points="1 4 1 10 7 10" />
        <Polyline points="23 20 23 14 17 14" />
        <Path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
      </Svg>
    )
  },
  {
    key: 'vocab',
    label: '生词本',
    icon: (c) => (
      <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.9}>
        <Path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
        <Path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
      </Svg>
    )
  },
  {
    key: 'fav',
    label: '收藏',
    icon: (c) => (
      <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.9}>
        <Polygon
          points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    )
  }
]

interface Props {
  active: DockTab
  onChange: (tab: DockTab) => void
}

/** 底部悬浮导航（设计稿 BottomDock 同款）：磨砂胶囊 + 图标 tab + 滑动选中 pill */
export default function BottomDock({ active, onChange }: Props): React.JSX.Element {
  const { dark, colors } = useTheme()
  const [dockW, setDockW] = React.useState(0)
  const activeIdx = Math.max(0, TABS.findIndex((t) => t.key === active))
  const anim = React.useRef(new Animated.Value(activeIdx)).current

  React.useEffect(() => {
    Animated.timing(anim, { toValue: activeIdx, duration: 220, useNativeDriver: true }).start()
  }, [activeIdx, anim])

  // dock 有 border 1 + paddingHorizontal 6，tab flex:1 等宽（内容宽 = dockW - 2 - 12）
  const tabW = dockW > 0 ? (dockW - 14) / TABS.length : 0
  // 选中 pill：36x36 正圆。RN 绝对定位相对父级 padding box（边框内沿），
  // 圆心对准 tab 中心：left = padding 6 + i*tabW + tabW/2 - 18（i*tabW 由 translateX 动画承担）
  const pillLeft = 6 + (tabW - 36) / 2

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View
        style={[
          styles.dock,
          { backgroundColor: dark ? 'rgba(22,24,31,0.96)' : 'rgba(255,255,255,0.96)', borderColor: colors.border }
        ]}
        onLayout={(e) => setDockW(e.nativeEvent.layout.width)}
      >
        {tabW > 0 && (
          <Animated.View
            style={[
              styles.pill,
              { left: pillLeft, transform: [{ translateX: Animated.multiply(anim, tabW) }] }
            ]}
          />
        )}
        {TABS.map((t) => {
          const on = active === t.key
          return (
            <TouchableOpacity
              key={t.key}
              style={styles.tab}
              activeOpacity={0.7}
              onPress={() => onChange(t.key)}
            >
              {t.icon(on ? colors.accent : colors.subtext)}
            </TouchableOpacity>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 14, paddingBottom: 8, paddingTop: 4 },
  dock: {
    height: 47,
    borderRadius: 24,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 6
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pill: {
    position: 'absolute',
    // 垂直居中（padding box 基准）：(dock 47 - border 2 - 36) / 2
    top: 4.5,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(10,132,255,0.18)'
  }
})
