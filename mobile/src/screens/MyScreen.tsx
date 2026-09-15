import React, { useMemo, useState } from 'react'
import { Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import {
  authCache,
  AuthSession,
  CuratedPrefs,
  Entitlement,
  fetchAnnounce,
  fetchEntitlement,
  loadPrefsCache,
  login,
  Plan,
  pullPrefs,
  putPrefs,
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
import { estimateLevelFromAnswers, LevelAnswer, LEVEL_TEST_WORDS } from '../lib/level-test'
import { RefreshIcon } from '../components/icons'

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
  // 词汇量定级向导（⑩）
  const [testOpen, setTestOpen] = useState(false)
  const [testIdx, setTestIdx] = useState(0)
  const [answers, setAnswers] = useState<LevelAnswer[]>([])

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

  /** 档位徽章色调（仅夜间叠加药丸样式用）：pro+ 绿 / pro 蓝 / 免费灰 */
  const planBadgeTone = !entitlement
    ? null
    : entitlement.plan === 'pro_plus'
      ? styles.badgeProPlus
      : entitlement.plan === 'pro'
        ? styles.badgePro
        : styles.badgeFree

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

  /* ---- ⑩ 词汇量定级向导 ---- */
  const TEST_TOTAL = LEVEL_TEST_WORDS.length
  const testFinished = testIdx >= TEST_TOTAL
  // 答完 24 词即估级（不满一半返回 null，正常流程不会发生）
  const testResult = useMemo(
    () => (testFinished ? estimateLevelFromAnswers(answers) : null),
    [testFinished, answers]
  )

  /** 开始/重新测：重置答题进度并打开向导 */
  const startTest = (): void => {
    setTestIdx(0)
    setAnswers([])
    setTestOpen(true)
  }

  const answer = (known: boolean): void => {
    const w = LEVEL_TEST_WORDS[testIdx]
    if (!w) return
    setAnswers((a) => [...a, { w: w.w, known }])
    setTestIdx((i) => i + 1)
  }

  /** 应用到精选推荐：写本地偏好缓存（保留已选标签）；已登录且付费档时 putPrefs 上云，失败静默 */
  const onApplyLevel = (): void => {
    if (!testResult) return
    const r = testResult
    void (async () => {
      const prev = await loadPrefsCache()
      const prefs: CuratedPrefs = { curatedLevel: r, curatedTags: prev?.curatedTags ?? [], updatedAt: Date.now() }
      await savePrefsCache(prefs)
      if (session && isPaidPlan(plan)) {
        try {
          await putPrefs(session.token, prefs)
        } catch {
          /* 上云失败静默，本地已存 */
        }
      }
      setTestOpen(false)
      setMsg({ text: `已应用：精选推荐按 ${r} 难度优先`, ok: true })
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
        {/* 账号卡（设计稿布局：已登录为 当前账号+徽章 / 到期子卡 / 卡密兑换行；未登录为登录表单） */}
        <View style={styles.card}>
          {session ? null : <Text style={styles.cardTitle}>账号</Text>}
          {session ? (
            <>
              {/* 第一行：左"当前账号"小字 + 邮箱大字；右上角档位药丸（pro+ 金 / pro 蓝 / 免费灰） */}
              <View style={styles.acctTopRow}>
                <View style={styles.acctTopLeft}>
                  <Text style={styles.acctLabel}>当前账号</Text>
                  <Text style={styles.acctEmail}>{session.email}</Text>
                </View>
                {entitlement ? (
                  <Text style={[styles.planBadge, planBadgeTone]}>
                    {entitlement.plan === 'pro_plus' ? '★ ' : ''}
                    {PLAN_LABEL[entitlement.plan]}
                  </Text>
                ) : null}
              </View>
              {/* 内嵌子卡：会员到期时间 + 圆形玻璃刷新图标按钮 */}
              <View style={styles.subCard}>
                <View style={styles.subCardRow}>
                  <View>
                    <Text style={styles.acctLabel}>会员到期时间</Text>
                    <Text style={styles.subCardTime}>
                      {entitlement ? fmtExpires(entitlement.expiresAt) : '—'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.refreshBtn, busy && styles.btnDisabled]}
                    disabled={busy}
                    onPress={onRefresh}
                    hitSlop={6}
                  >
                    <RefreshIcon size={15} color={dark ? '#f5f5f7' : colors.subtext} />
                  </TouchableOpacity>
                </View>
              </View>
              {/* 卡密兑换：输入框与蓝色胶囊按钮同一行 */}
              <View style={styles.inlineRow}>
                <TextInput
                  style={[styles.input, styles.inputInline]}
                  value={cardCode}
                  onChangeText={setCardCode}
                  placeholder="请输入卡密兑换码"
                  placeholderTextColor={colors.subtext}
                  autoCapitalize="characters"
                  autoCorrect={false}
                />
                <TouchableOpacity
                  style={[styles.btn, styles.btnPrimary, styles.btnInline, busy && styles.btnDisabled]}
                  disabled={busy}
                  onPress={onRedeem}
                >
                  <Text style={[styles.btnText, styles.btnPrimaryText]}>兑换</Text>
                </TouchableOpacity>
              </View>
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
                style={[styles.btn, styles.btnPrimary, (busy || countdown > 0) && styles.btnDisabled]}
                disabled={busy || countdown > 0}
                onPress={onSendCode}
              >
                <Text style={[styles.btnText, styles.btnPrimaryText]}>
                  {countdown > 0 ? `重新发送（${countdown}s）` : '发送验证码'}
                </Text>
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
              <TouchableOpacity
                style={[styles.btn, styles.btnPrimary, busy && styles.btnDisabled]}
                disabled={busy}
                onPress={onLogin}
              >
                <Text style={[styles.btnText, styles.btnPrimaryText]}>登录</Text>
              </TouchableOpacity>
            </>
          )}
          {msg ? <Text style={[styles.msg, !msg.ok && styles.msgErr]}>{msg.text}</Text> : null}
        </View>
        {/* C1 自定义频道订阅（pro 起；审核通过后随下次内容更新进精选） */}
        <View style={styles.card}>
          <View style={styles.cardTitleRow}>
            <View style={styles.cardTitleLeft}>
              <View style={styles.accentBar} />
              <Text style={styles.cardTitle}>自定义频道订阅</Text>
            </View>
            <Text style={styles.sideLabel}>次日更新精选推荐</Text>
          </View>
          <Text style={styles.hint}>提交你想看的 YouTube 频道，审核通过后随下次内容更新进入精选推荐</Text>
          <View style={styles.inlineRow}>
            <TextInput
              style={[styles.input, styles.inputInline, !canSubmitChannel && styles.inputDisabled]}
              value={channel}
              onChangeText={setChannel}
              placeholder="@频道名 或频道链接"
              placeholderTextColor={colors.subtext}
              autoCapitalize="none"
              autoCorrect={false}
              editable={canSubmitChannel && !channelBusy}
            />
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary, styles.btnInline, (channelBusy || !canSubmitChannel) && styles.btnDisabled]}
              disabled={channelBusy || !canSubmitChannel}
              onPress={onSubmitChannel}
            >
              <Text style={[styles.btnText, styles.btnPrimaryText]}>提交</Text>
            </TouchableOpacity>
          </View>
          {canSubmitChannel ? null : <Text style={styles.hint}>pro 及以上可用</Text>}
          {channelMsg ? (
            <Text style={[styles.msg, !channelMsg.ok && styles.msgErr]}>{channelMsg.text}</Text>
          ) : null}
        </View>
        {/* ⑩ 词汇量定级向导：左标题+说明，右侧开始测试胶囊 */}
        <View style={styles.card}>
          <View style={styles.testRow}>
            <View style={styles.testRowText}>
              <Text style={styles.cardTitle}>测一测你的英语水平</Text>
              <Text style={styles.hint}>24 个词快速估计 CEFR 等级，结果可一键应用到精选推荐难度</Text>
            </View>
            <TouchableOpacity style={[styles.btn, styles.btnPrimary, styles.btnInline]} onPress={startTest}>
              <Text style={[styles.btnText, styles.btnPrimaryText]}>开始测试</Text>
            </TouchableOpacity>
          </View>
        </View>
        {/* 退出登录：全宽红字、透明底+玻璃细描边（设计稿无卡片容器） */}
        {session ? (
          <TouchableOpacity style={styles.logoutBig} onPress={onLogout}>
            <Text style={styles.logoutBigText}>退出当前登录</Text>
          </TouchableOpacity>
        ) : null}
        {/* 后续订阅/付费区块挂在账号卡下方 */}
        {/* 服务端公告胶囊块：空串不渲染，文案原样输出 */}
        {announce ? (
          <View style={styles.announce}>
            <Text style={styles.announceText}>{announce}</Text>
          </View>
        ) : null}
      </ScrollView>
      {/* 定级向导：一次一词大号居中，认识/不认识；答完出结果可应用到精选推荐 */}
      <Modal visible={testOpen} animationType="slide" onRequestClose={() => setTestOpen(false)}>
        <View style={styles.testWrap}>
          <Text style={styles.testProgress}>
            {Math.min(testIdx + 1, TEST_TOTAL)}/{TEST_TOTAL}
          </Text>
          <View style={styles.testCenter}>
            {testFinished ? (
              <>
                <Text style={styles.testResult}>
                  {testResult ? `你的水平约为 ${testResult}` : '答题不足，无法估计'}
                </Text>
                <TouchableOpacity
                  style={[styles.btn, styles.testBtnPrimary, !testResult && styles.btnDisabled]}
                  disabled={!testResult}
                  onPress={onApplyLevel}
                >
                  <Text style={styles.testBtnPrimaryText}>应用到精选推荐</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.btn} onPress={startTest}>
                  <Text style={styles.btnText}>重新测</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.hint}>这个词你认识吗？</Text>
                <Text style={styles.testWord}>{LEVEL_TEST_WORDS[testIdx].w}</Text>
                <View style={styles.testBtnRow}>
                  <TouchableOpacity style={[styles.btn, styles.testBtn]} onPress={() => answer(false)}>
                    <Text style={styles.btnText}>不认识</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.btn, styles.testBtn, styles.testBtnPrimary]}
                    onPress={() => answer(true)}
                  >
                    <Text style={styles.testBtnPrimaryText}>认识</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
          <TouchableOpacity style={styles.testClose} onPress={() => setTestOpen(false)}>
            <Text style={styles.btnText}>关闭</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  )
}

// 夜间按设计稿 Apple Midnight Glass（docs-internal/DESIGN-apple-midnight-glass.md）：
// 近黑底 #0c0d10；玻璃卡 = 半透明底 rgba(28,30,36,0.72) + 0.5~1px 细描边模拟（RN 不支持
// backdrop-filter 模糊，且不加 expo-blur 原生依赖）；主按钮 accent 胶囊。日间逐项沿用旧版样式值。
const makeStyles = (c: ThemeColors, dark: boolean) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: dark ? '#0c0d10' : c.bg },
  header: {
    color: dark ? '#f5f5f7' : c.text,
    fontSize: dark ? 24 : 18,
    fontWeight: dark ? '700' : '600',
    letterSpacing: dark ? -0.48 : 0, // 设计稿 -0.02em × 24px
    padding: 14,
    paddingBottom: 4
  },
  body: { flex: 1, paddingHorizontal: dark ? 14 : 12 },
  card: {
    backgroundColor: dark ? 'rgba(28,30,36,0.72)' : c.card,
    borderRadius: dark ? 16 : 8,
    borderWidth: dark ? 1 : 0,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 14,
    marginTop: dark ? 12 : 8 // 设计稿 gutter 12px
  },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitleLeft: { flexDirection: 'row', alignItems: 'center' },
  accentBar: {
    width: 3,
    height: 12,
    borderRadius: 2,
    backgroundColor: dark ? '#0a84ff' : c.accent,
    marginRight: 6
  },
  sideLabel: { color: dark ? '#8e8e93' : c.subtext, fontSize: 11 },
  cardTitle: {
    color: dark ? '#f5f5f7' : c.text,
    fontSize: dark ? 13 : 16,
    fontWeight: '600',
    letterSpacing: dark ? -0.13 : 0
  },
  hint: {
    color: dark ? '#8e8e93' : c.subtext,
    fontSize: dark ? 11 : 12,
    marginTop: 6,
    lineHeight: dark ? 14 : 18
  },
  // 账号卡第一行：左侧"当前账号"小字 + 邮箱大字，右上角档位药丸
  acctTopRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  acctTopLeft: { flex: 1, paddingRight: 10 },
  acctLabel: { color: dark ? '#8e8e93' : c.subtext, fontSize: 11 },
  acctEmail: { color: dark ? '#f5f5f7' : c.text, fontSize: dark ? 16 : 15, fontWeight: '600', marginTop: 3 },
  // 档位徽章（药丸）：pro+ 金 / pro 蓝 / 免费灰
  planBadge: {
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden'
  },
  badgeFree: dark
    ? { color: '#8e8e93', backgroundColor: 'rgba(255,255,255,0.08)' }
    : { color: '#64748B', backgroundColor: 'rgba(0,0,0,0.06)' },
  badgePro: dark
    ? { color: '#0a84ff', backgroundColor: 'rgba(10,132,255,0.15)' }
    : { color: '#007AFF', backgroundColor: 'rgba(0,122,255,0.10)' },
  badgeProPlus: dark
    ? { color: '#ffd60a', backgroundColor: 'rgba(255,214,10,0.15)' }
    : { color: '#8a6d00', backgroundColor: 'rgba(255,214,10,0.30)' },
  // 内嵌子卡（更深半透底）：会员到期时间 + 圆形玻璃刷新图标按钮
  subCard: {
    marginTop: 12,
    borderRadius: dark ? 12 : 8,
    borderWidth: dark ? 0.5 : 0,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: dark ? 'rgba(0,0,0,0.28)' : 'rgba(0,0,0,0.04)',
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  subCardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  subCardTime: { color: dark ? '#f5f5f7' : c.text, fontSize: dark ? 13 : 14, marginTop: 3 },
  refreshBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    borderWidth: dark ? 0.5 : 0,
    borderColor: 'rgba(255,255,255,0.12)'
  },
  // 输入框与蓝色胶囊按钮同一行（输入框 flex:1，按钮在右）
  inlineRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  inputInline: { flex: 1, marginTop: 0 },
  btnInline: { marginTop: 0, paddingHorizontal: 18 },
  input: {
    backgroundColor: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    borderWidth: dark ? 0.5 : 0,
    borderColor: 'rgba(255,255,255,0.08)',
    color: dark ? '#f5f5f7' : c.text,
    borderRadius: dark ? 12 : 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: dark ? 13 : 14,
    marginTop: 12
  },
  // 次级按钮：夜间玻璃胶囊；主按钮叠 btnPrimary 变 accent 蓝
  btn: {
    backgroundColor: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    borderWidth: dark ? 0.5 : 0,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: dark ? 999 : 8,
    paddingVertical: dark ? 11 : 10,
    alignItems: 'center',
    marginTop: 12
  },
  btnPrimary: dark ? { backgroundColor: '#0a84ff', borderWidth: 0 } : {},
  btnPrimaryText: dark ? { color: '#fff', fontWeight: '600' } : {},
  btnDisabled: { opacity: 0.4 },
  inputDisabled: { opacity: 0.5 },
  btnText: { color: dark ? '#f5f5f7' : c.text, fontSize: dark ? 13 : 15 },
  msg: { color: dark ? '#30d158' : '#3ecf8e', fontSize: 13, marginTop: 12 },
  msgErr: { color: dark ? '#ff453a' : '#ff6b6b' },
  // 定级卡：左标题+说明，右侧开始测试按钮
  testRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  testRowText: { flex: 1 },
  // 退出当前登录：页级全宽大按钮，红字、透明底 + 玻璃细描边
  logoutBig: {
    marginTop: dark ? 12 : 8,
    borderRadius: dark ? 999 : 8,
    borderWidth: dark ? 0.5 : 1,
    borderColor: dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.15)',
    backgroundColor: dark ? 'rgba(255,255,255,0.05)' : 'transparent',
    paddingVertical: dark ? 12 : 10,
    alignItems: 'center'
  },
  logoutBigText: { color: dark ? '#ff453a' : '#ff6b6b', fontSize: dark ? 13 : 15, fontWeight: '600' },
  announce: {
    marginTop: 12,
    marginBottom: 16,
    borderRadius: dark ? 16 : 18,
    borderWidth: dark ? 0.5 : 1,
    borderColor: dark ? 'rgba(255,255,255,0.12)' : c.accent,
    backgroundColor: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,122,255,0.08)',
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  announceText: { color: dark ? '#e3e2e7' : c.text, fontSize: 13, lineHeight: dark ? 18 : 19 },
  testWrap: { flex: 1, backgroundColor: dark ? '#0c0d10' : c.bg, padding: 20, paddingTop: 40 },
  testProgress: { color: dark ? '#8e8e93' : c.subtext, fontSize: dark ? 11 : 13, textAlign: 'center' },
  testCenter: { flex: 1, justifyContent: 'center' },
  testWord: {
    color: dark ? '#f5f5f7' : c.text,
    fontSize: 34,
    fontWeight: '700',
    marginTop: 12,
    textAlign: 'center'
  },
  testResult: {
    color: dark ? '#f5f5f7' : c.text,
    fontSize: 22,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8
  },
  testBtnRow: { flexDirection: 'row', gap: 12, marginTop: 32 },
  testBtn: { flex: 1, marginTop: 0 },
  testBtnPrimary: { backgroundColor: c.accent, borderWidth: 0 },
  testBtnPrimaryText: { color: '#fff', fontSize: dark ? 13 : 15, fontWeight: '600' },
  testClose: { paddingVertical: 12, alignItems: 'center' }
})
