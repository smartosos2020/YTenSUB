import React, { useMemo } from 'react'
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { ThemeColors, useTheme } from '../lib/theme'
import { LockIcon } from './icons'

/** 付费档位权益文案（B2 付费墙；暂无真实价格/支付，引导去「我的」兑换卡密） */
const PLAN_PITCH: { name: string; points: string[] }[] = [
  { name: 'pro', points: ['全部精选', '每日更新', '自定义频道订阅', '偏好双端同步'] },
  { name: 'pro+', points: ['pro 全部', '精选字幕秒出'] }
]

interface Props {
  visible: boolean
  onClose: () => void
  /** 点主按钮：关弹窗并切到「我的」tab */
  onGoMy: () => void
}

/** 付费墙弹窗：精选免费额度用完后点锁定卡片弹出 */
export default function PaywallSheet({ visible, onClose, onGoMy }: Props): React.JSX.Element {
  const { dark, colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors, dark), [colors, dark])

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.mask} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.lockRow}>
            <LockIcon size={20} color={colors.accent} />
            <Text style={styles.title}>升级解锁全部精选</Text>
          </View>
          {PLAN_PITCH.map((p) => (
            <View key={p.name} style={styles.planBlock}>
              <Text style={styles.planName}>{p.name}</Text>
              <Text style={styles.planPoints}>{p.points.join(' · ')}</Text>
            </View>
          ))}
          <TouchableOpacity style={styles.cta} onPress={onGoMy}>
            <Text style={styles.ctaText}>去「我的」兑换卡密</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.btnText}>关闭</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const makeStyles = (c: ThemeColors, dark: boolean) =>
  StyleSheet.create({
  mask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: dark ? '#1c1c1e' : c.card,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    padding: 18,
    paddingBottom: 28
  },
  lockRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: c.text, fontSize: 17, fontWeight: '600' },
  planBlock: { marginTop: 14 },
  planName: { color: c.text, fontSize: 15, fontWeight: '600' },
  planPoints: { color: c.subtext, fontSize: 13, lineHeight: 20, marginTop: 4 },
  cta: {
    backgroundColor: c.accent,
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: 'center',
    marginTop: 18
  },
  ctaText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  btnText: { color: c.text, fontSize: 15 },
  closeBtn: { marginTop: 10, paddingVertical: 10, alignItems: 'center' }
})
