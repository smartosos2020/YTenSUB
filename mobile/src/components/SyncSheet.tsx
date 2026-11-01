import React, { useMemo, useState } from 'react'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { Modal, Pressable, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { normalizeAddr, pullFromDesktop, pushToDesktop } from '../lib/sync'
import { ThemeColors, useTheme } from '../lib/theme'

const ADDR_KEY = 'ytensub:sync-addr'
const TOKEN_KEY = 'ytensub:sync-token'

interface Props {
  visible: boolean
  onClose: () => void
  /** 同步完成后刷新外部数据 */
  onSynced: () => void
}

export default function SyncSheet({ visible, onClose, onSynced }: Props): React.JSX.Element {
  const { dark, colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors, dark), [colors, dark])
  const [addr, setAddr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanned, setScanned] = useState(false)
  const [permission, requestPermission] = useCameraPermissions()

  React.useEffect(() => {
    if (visible) {
      setMsg('')
      void AsyncStorage.getItem(ADDR_KEY).then((value) => value && setAddr(value))
    } else {
      setScanning(false)
      setScanned(false)
    }
  }, [visible])

  const run = async (
    fn: (base: string, token: string | null) => Promise<{ vocab: number; shadowing: number }>,
    verb: string
  ): Promise<void> => {
    const base = normalizeAddr(addr)
    if (!base) {
      setMsg('地址格式不对，例如 192.168.0.10 或 http://192.168.0.10:47832')
      return
    }
    setBusy(true)
    setMsg('')
    try {
      await AsyncStorage.setItem(ADDR_KEY, base)
      const token = await AsyncStorage.getItem(TOKEN_KEY)
      const result = await fn(base, token)
      setMsg(`${verb}成功：生词 ${result.vocab} 条，跟读脚本 ${result.shadowing} 部`)
      onSynced()
    } catch (error) {
      setMsg(String(error).includes('401')
        ? '配对已失效，请在电脑端重新显示配对码并扫码'
        : `${verb}失败：连不上电脑（确认电脑端已开启同步、同一 WiFi）`)
    } finally {
      setBusy(false)
    }
  }

  const startScan = async (): Promise<void> => {
    if (!permission?.granted) {
      const result = await requestPermission()
      if (!result.granted) {
        setMsg('需要允许相机权限才能扫描电脑上的配对码')
        return
      }
    }
    setMsg('')
    setScanned(false)
    setScanning(true)
  }

  const acceptPairingCode = async (data: string): Promise<void> => {
    if (scanned) return
    setScanned(true)
    try {
      const pair = JSON.parse(data) as {
        type?: string
        version?: number
        baseUrl?: string
        token?: string
      }
      const base = pair.type === 'ytensub-sync' && pair.version === 1 && pair.token
        ? normalizeAddr(pair.baseUrl ?? '')
        : null
      if (!base || !pair.token) throw new Error('invalid pairing code')
      await AsyncStorage.multiSet([[ADDR_KEY, base], [TOKEN_KEY, pair.token]])
      setAddr(base)
      setScanning(false)
      setMsg('配对成功。手机和电脑需连接同一个 WiFi。')
    } catch {
      setScanning(false)
      setMsg('配对码无效，请在电脑端重新显示配对码')
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.mask} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.title}>与电脑同步</Text>
          <Text style={styles.hint}>电脑端：设置 → 数据维护 → 显示手机配对码。手机和电脑需连接同一个 WiFi。</Text>
          {scanning ? (
            <View style={styles.scannerWrap}>
              <CameraView
                style={styles.camera}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={({ data }) => void acceptPairingCode(data)}
              />
              <TouchableOpacity style={styles.scanCancel} onPress={() => setScanning(false)}>
                <Text style={styles.btnText}>取消扫码</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.scanBtn} onPress={() => void startScan()}>
              <Text style={styles.btnText}>扫码配对</Text>
            </TouchableOpacity>
          )}
          <TextInput
            style={styles.input}
            value={addr}
            onChangeText={(value) => {
              setAddr(value)
              void AsyncStorage.removeItem(TOKEN_KEY)
            }}
            placeholder="电脑地址（配对码可自动填写）"
            placeholderTextColor={colors.subtext}
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
    title: { color: c.text, fontSize: 17, fontWeight: '600' },
    hint: { color: c.subtext, fontSize: 12, marginTop: 6, lineHeight: 18 },
    scanBtn: { marginTop: 12, backgroundColor: c.accent, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
    scannerWrap: { height: 260, marginTop: 12, overflow: 'hidden', borderRadius: 10 },
    camera: { flex: 1 },
    scanCancel: { position: 'absolute', bottom: 10, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 8, paddingHorizontal: 18, paddingVertical: 8 },
    input: {
      backgroundColor: dark ? '#262626' : 'rgba(0,0,0,0.06)',
      color: c.text,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      fontSize: 14,
      marginTop: 12
    },
    row: { flexDirection: 'row', gap: 10, marginTop: 14 },
    btn: {
      flex: 1,
      backgroundColor: dark ? '#2c2c2e' : 'rgba(0,0,0,0.06)',
      borderRadius: 8,
      paddingVertical: 10,
      alignItems: 'center'
    },
    btnDisabled: { opacity: 0.4 },
    btnText: { color: c.text, fontSize: 15 },
    msg: { color: '#3ecf8e', fontSize: 13, marginTop: 12 },
    closeBtn: { marginTop: 10, paddingVertical: 10, alignItems: 'center' }
  })
