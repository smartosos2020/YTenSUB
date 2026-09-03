import React, { useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { normalizeAddr, pullFromDesktop, pushToDesktop } from '../lib/sync'

const ADDR_KEY = 'ytensub:sync-addr'

interface Props {
  visible: boolean
  onClose: () => void
  /** 同步完成后刷新外部数据 */
  onSynced: () => void
}

/** 与电脑端同步（生词本 + 跟读脚本）：电脑端设置页开启服务后，把显示的地址填进来 */
export default function SyncSheet({ visible, onClose, onSynced }: Props): React.JSX.Element {
  const [addr, setAddr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  React.useEffect(() => {
    if (visible) {
      setMsg('')
      void AsyncStorage.getItem(ADDR_KEY).then((v) => v && setAddr(v))
    }
  }, [visible])

  const run = async (fn: (base: string) => Promise<{ vocab: number; shadowing: number }>, verb: string): Promise<void> => {
    const base = normalizeAddr(addr)
    if (!base) {
      setMsg('地址格式不对，例如 192.168.0.10 或 http://192.168.0.10:47832')
      return
    }
    setBusy(true)
    setMsg('')
    try {
      await AsyncStorage.setItem(ADDR_KEY, base)
      const r = await fn(base)
      setMsg(`${verb}成功：生词 ${r.vocab} 条，跟读脚本 ${r.shadowing} 部`)
      onSynced()
    } catch {
      setMsg(`${verb}失败：连不上电脑（确认电脑端已开启同步、同一 WiFi）`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.mask} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.title}>与电脑同步</Text>
          <Text style={styles.hint}>电脑端：设置 → 数据维护与同步 → 开启手机同步，把显示的地址填到这里</Text>
          <TextInput
            style={styles.input}
            value={addr}
            onChangeText={setAddr}
            placeholder="例如 192.168.0.10"
            placeholderTextColor="#666"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <View style={styles.row}>
            <TouchableOpacity
              style={[styles.btn, busy && styles.btnDisabled]}
              disabled={busy}
              onPress={() => void run(pullFromDesktop, '拉取')}
            >
              <Text style={styles.btnText}>从电脑拉取</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, busy && styles.btnDisabled]}
              disabled={busy}
              onPress={() => void run(pushToDesktop, '推送')}
            >
              <Text style={styles.btnText}>推送到电脑</Text>
            </TouchableOpacity>
          </View>
          {msg ? <Text style={styles.msg}>{msg}</Text> : null}
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.btnText}>关闭</Text>
          </TouchableOpacity>
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
  title: { color: '#fff', fontSize: 17, fontWeight: '600' },
  hint: { color: '#9aa0a6', fontSize: 12, marginTop: 6, lineHeight: 18 },
  input: {
    backgroundColor: '#262626',
    color: '#e8e8e8',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    marginTop: 12
  },
  row: { flexDirection: 'row', gap: 10, marginTop: 14 },
  btn: {
    flex: 1,
    backgroundColor: '#2c2c2e',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center'
  },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: '#e8e8e8', fontSize: 15 },
  msg: { color: '#3ecf8e', fontSize: 13, marginTop: 12 },
  closeBtn: { marginTop: 10, paddingVertical: 10, alignItems: 'center' }
})
