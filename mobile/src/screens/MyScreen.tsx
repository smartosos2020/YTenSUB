import React, { useMemo, useState } from 'react'
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import {
  authCache,
  AuthSession,
  Entitlement,
  fetchAnnounce,
  fetchEntitlement,
  login,
  Plan,
  pullPrefs,
  redeemCard,
  requestCode,
  savePrefsCache,
  saveSession,
  submitChannel
} from '../lib/auth'
import {
  cacheEntitlement,
  effectiveCachedPlan,
  isPaidPlan,
  loadEntitlementCache,
  saveEntitlementCache
} from '../lib/entitlement'
import { ThemeColors, useTheme } from '../lib/theme'

/** 档位显示名 */
const PLAN_LABEL: Record<Entitlement['plan'], string> = { free: '免费', pro: 'pro', pro_plus: 'pro+' }

/** 到期时间本地化；null = 从未付费显示 — */
function fmtExpires(at: number | null): string {
  return at ? new Date(at).toLocaleString('zh-CN', { hour12: false }) : '—'
}

/**
 * 我的：账号模块（邮箱验证码登录 / 卡密兑换 / 权益展示 / 登出）+ 自定义频道订阅（pro 起）。
 * 后续订阅/付费相关区块也放本页（账号卡下方）。
 * tab 切换重新挂载即重新读 authCache / 权益缓存，无需额外刷新动作。
 */
export default function MyScreen(): React.JSX.Element {
  const { dark, colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors, dark), [colors, dark])
  const [session, setSession] = useState<AuthSession | null>(authCache.session)
  const [entitlement, setEntitlement] = useState<Entitlement | null>(authCache.entitlement)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [cardCode, setCardCode] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  // 当前生效档位（含离线宽限）：挂载时从本地缓存算；登录/兑换/刷新后同步更新
  const [plan, setPlan] = useState<Plan>('free')
  // 自定义频道订阅（独立 busy/msg，与账号卡互不影响）
  const [channel, setChannel] = useState('')
  const [channelBusy, setChannelBusy] = useState(false)
  const [channelMsg, setChannelMsg] = useState<{ text: string; ok: boolean } | null>(null)
  // 服务端公告（空串 = 不显示）
  const [announce, setAnnounce] = useState('')

  // 挂载时按本地缓存+宽限期定档位
  React.useEffect(() => {
    void loadEntitlementCache().then((c) => setPlan(effectiveCachedPlan(c, Date.now())))
  }, [])

  // 挂载时拉服务端公告；失败静默（当作没有公告）
  React.useEffect(() => {
    fetchAnnounce()
      .then((r) => setAnnounce(r.text))
      .catch(() => {})
  }, [])

  /** 自定义频道订阅可用：已登录且 pro 及以上 */
  const canSubmitChannel = session !== null && isPaidPlan(plan)

  // 发送验证码后的 60s 倒计时
  React.useEffect(() => {
    if (countdown <= 0) return
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown])

  /** 统一包一层异步执行：busy 开关 + 错误直接展示 Error.message */
  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setMsg(null)
    try {
      await fn()
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), ok: false })
    } finally {
      setBusy(false)
    }
  }

  const onSendCode = (): void => {
    const addr = email.trim()
    if (!addr.includes('@')) {
      setMsg({ text: '请输入正确的邮箱地址', ok: false })
      return
    }
    void run(async () => {
      const r = await requestCode(addr)
      setCountdown(60)
      // DEV_MODE 服务端会直接返回 devCode，本地联调免查邮箱
      setMsg({ text: r.devCode ? `DEV 验证码：${r.devCode}` : '验证码已发送，请查收邮件', ok: true })
    })
  }

  const onLogin = (): void => {
    const addr = email.trim()
    if (!code.trim()) {
      setMsg({ text: '请输入验证码', ok: false })
      return
    }
    void run(async () => {
      const r = await login(addr, code.trim())
      const s = { email: addr, token: r.token }
      authCache.session = s
      authCache.entitlement = r.entitlement
      await saveSession(s)
      await saveEntitlementCache(cacheEntitlement(r.entitlement, Date.now()))
      setSession(s)
      setEntitlement(r.entitlement)
      setPlan(r.entitlement.plan)
      setCode('')
      // 登录成功后拉服务器偏好覆盖本地（服务器为准，MVP 简化策略）
      void pullPrefs(s.token)
    })
  }

  const onRefresh = (): void => {
    if (!session) return
    void run(async () => {
      const r = await fetchEntitlement(session.token)
      authCache.entitlement = r.entitlement
      await saveEntitlementCache(cacheEntitlement(r.entitlement, Date.now()))
      setEntitlement(r.entitlement)
      setPlan(r.entitlement.plan)
      setMsg({ text: '权益已刷新', ok: true })
    })
  }

  const onRedeem = (): void => {
    if (!session) return
    if (!cardCode.trim()) {
      setMsg({ text: '请输入卡密', ok: false })
      return
    }
    void run(async () => {
      const r = await redeemCard(session.token, cardCode.trim())
      authCache.entitlement = r.entitlement
      await saveEntitlementCache(cacheEntitlement(r.entitlement, Date.now()))
      setEntitlement(r.entitlement)
      setPlan(r.entitlement.plan)
      setCardCode('')
      setMsg({ text: '兑换成功', ok: true })
    })
  }

  /** C1：提交自定义频道（pro 起；pending=待审核，approved=已在库中） */
  const onSubmitChannel = (): void => {
    if (!session || !canSubmitChannel) return
    const h = channel.trim()
    if (!h) {
      setChannelMsg({ text: '请输入频道名或链接', ok: false })
      return
    }
    setChannelBusy(true)
    setChannelMsg(null)
    void (async () => {
      try {
        const r = await submitChannel(session.token, h)
        setChannel('')
        setChannelMsg({ text: r.status === 'approved' ? '该频道已在库中' : '已提交，待审核', ok: true })
      } catch (e) {
        setChannelMsg({ text: e instanceof Error ? e.message : String(e), ok: false })
      } finally {
        setChannelBusy(false)
      }
    })()
  }

  const onLogout = (): void => {
    authCache.session = null
    authCache.entitlement = null
    void saveSession(null)
    // 登出同时清权益/偏好本地缓存，避免下个账号看到旧数据
    void saveEntitlementCache(null)
    void savePrefsCache(null)
    setSession(null)
    setEntitlement(null)
    setPlan('free')
    setEmail('')
    setCode('')
    setChannel('')
    setChannelMsg(null)
    setMsg(null)
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header}>我的</Text>
      <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
        {/* 账号卡 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>账号</Text>
          {session ? (
            <>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>邮箱</Text>
                <Text style={styles.infoValue}>{session.email}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>档位</Text>
                <Text style={styles.infoValue}>{entitlement ? PLAN_LABEL[entitlement.plan] : '—'}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>到期时间</Text>
                <Text style={styles.infoValue}>{entitlement ? fmtExpires(entitlement.expiresAt) : '—'}</Text>
              </View>
              <TouchableOpacity
                style={[styles.btn, busy && styles.btnDisabled]}
                disabled={busy}
                onPress={onRefresh}
              >
                <Text style={styles.btnText}>刷新权益</Text>
              </TouchableOpacity>
              <TextInput
                style={styles.input}
                value={cardCode}
                onChangeText={setCardCode}
                placeholder="卡密兑换码"
                placeholderTextColor={colors.subtext}
                autoCapitalize="characters"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={[styles.btn, busy && styles.btnDisabled]}
                disabled={busy}
                onPress={onRedeem}
              >
                <Text style={styles.btnText}>兑换</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.hint}>邮箱验证码登录，无需注册</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="邮箱"
                placeholderTextColor={colors.subtext}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
              />
              <TouchableOpacity
                style={[styles.btn, (busy || countdown > 0) && styles.btnDisabled]}
                disabled={busy || countdown > 0}
                onPress={onSendCode}
              >
                <Text style={styles.btnText}>{countdown > 0 ? `重新发送（${countdown}s）` : '发送验证码'}</Text>
              </TouchableOpacity>
              <TextInput
                style={styles.input}
                value={code}
                onChangeText={setCode}
                placeholder="验证码"
                placeholderTextColor={colors.subtext}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="number-pad"
              />
              <TouchableOpacity style={[styles.btn, busy && styles.btnDisabled]} disabled={busy} onPress={onLogin}>
                <Text style={styles.btnText}>登录</Text>
              </TouchableOpacity>
            </>
          )}
          {msg ? <Text style={[styles.msg, !msg.ok && styles.msgErr]}>{msg.text}</Text> : null}
          {session ? (
            <TouchableOpacity style={styles.logoutBtn} onPress={onLogout}>
              <Text style={styles.logoutText}>登出</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        {/* C1 自定义频道订阅（pro 起；审核通过后随下次内容更新进精选） */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>自定义频道订阅</Text>
          <Text style={styles.hint}>提交你想看的 YouTube 频道，审核通过后随下次内容更新进入精选推荐</Text>
          <TextInput
            style={[styles.input, !canSubmitChannel && styles.inputDisabled]}
            value={channel}
            onChangeText={setChannel}
            placeholder="@频道名 或频道链接"
            placeholderTextColor={colors.subtext}
            autoCapitalize="none"
            autoCorrect={false}
            editable={canSubmitChannel && !channelBusy}
          />
          <TouchableOpacity
            style={[styles.btn, (channelBusy || !canSubmitChannel) && styles.btnDisabled]}
            disabled={channelBusy || !canSubmitChannel}
            onPress={onSubmitChannel}
          >
            <Text style={styles.btnText}>提交</Text>
          </TouchableOpacity>
          {canSubmitChannel ? null : <Text style={styles.hint}>pro 及以上可用</Text>}
          {channelMsg ? (
            <Text style={[styles.msg, !channelMsg.ok && styles.msgErr]}>{channelMsg.text}</Text>
          ) : null}
        </View>
        {/* 后续订阅/付费区块挂在账号卡下方 */}
        {/* 服务端公告胶囊块：空串不渲染，文案原样输出 */}
        {announce ? (
          <View style={styles.announce}>
            <Text style={styles.announceText}>{announce}</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  )
}

const makeStyles = (c: ThemeColors, dark: boolean) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  header: { color: c.text, fontSize: 18, fontWeight: '600', padding: 14, paddingBottom: 4 },
  body: { flex: 1, paddingHorizontal: 12 },
  card: { backgroundColor: c.card, borderRadius: 8, padding: 14, marginTop: 8 },
  cardTitle: { color: c.text, fontSize: 16, fontWeight: '600' },
  hint: { color: c.subtext, fontSize: 12, marginTop: 6, lineHeight: 18 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  infoLabel: { color: c.subtext, fontSize: 14 },
  infoValue: { color: c.text, fontSize: 14 },
  input: {
    backgroundColor: dark ? '#262626' : 'rgba(0,0,0,0.06)',
    color: c.text,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    marginTop: 12
  },
  btn: {
    backgroundColor: dark ? '#2c2c2e' : 'rgba(0,0,0,0.06)',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 12
  },
  btnDisabled: { opacity: 0.4 },
  inputDisabled: { opacity: 0.5 },
  btnText: { color: c.text, fontSize: 15 },
  msg: { color: '#3ecf8e', fontSize: 13, marginTop: 12 },
  msgErr: { color: '#ff6b6b' },
  logoutBtn: { marginTop: 8, paddingVertical: 10, alignItems: 'center' },
  logoutText: { color: '#ff6b6b', fontSize: 15 },
  announce: {
    marginTop: 12,
    marginBottom: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: c.accent,
    backgroundColor: dark ? 'rgba(10,132,255,0.15)' : 'rgba(0,122,255,0.08)',
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  announceText: { color: c.text, fontSize: 13, lineHeight: 19 }
})
