import { useEffect, useState } from 'react'
import { Button, TextInput } from '@mantine/core'
import { api } from '../api'
import { AuthSession, Entitlement, Plan, fetchAnnounce, fetchEntitlement, login, redeemCard, requestCode, submitChannel } from '../../../shared/auth-api'
import { cacheEntitlement, effectiveCachedPlan, isPaidPlan } from '../../../shared/entitlement'
import { pullPrefsToSettings } from '../lib/account-sync'
import PageShell from '../components/PageShell'

/** 权益档位展示文案 */
const PLAN_LABEL: Record<Plan, string> = { free: '免费', pro: 'pro', pro_plus: 'pro+' }

/**
 * 我的：账号与权益 + 自定义频道订阅（后续订阅/付费区块按同样式追加 settings-group）。
 * 会话（auth）与权益缓存落库持久化（离线按 graceDays 宽限）；页面展示用内存态 entitlement。
 */
export default function ProfilePage(): JSX.Element {
  const [auth, setAuth] = useState<AuthSession | null>(null)
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null)
  const [authEmail, setAuthEmail] = useState('')
  const [authCode, setAuthCode] = useState('')
  const [codeSending, setCodeSending] = useState(false)
  const [codeCooldown, setCodeCooldown] = useState(0)
  const [loggingIn, setLoggingIn] = useState(false)
  const [cardCode, setCardCode] = useState('')
  const [redeeming, setRedeeming] = useState(false)
  const [entRefreshing, setEntRefreshing] = useState(false)
  // 账号区操作反馈：ok=true 成功（accent 色），false 失败（红色，直接展示 Error.message）
  const [authMsg, setAuthMsg] = useState<{ ok: boolean; text: string } | null>(null)
  // 离线宽限档位（本地缓存算出）：在线权益拉不到时用于付费功能闸门
  const [gracePlan, setGracePlan] = useState<Plan>('free')
  // 自定义频道订阅（C1，pro 起）
  const [channelHandle, setChannelHandle] = useState('')
  const [channelSubmitting, setChannelSubmitting] = useState(false)
  const [channelMsg, setChannelMsg] = useState<{ ok: boolean; text: string } | null>(null)
  // 服务端公告（购买卡密指引等，作者管理页可改）：空串 = 不显示
  const [announce, setAnnounce] = useState('')

  useEffect(() => {
    api.entitlementGet()
      .then((c) => setGracePlan(effectiveCachedPlan(c, Date.now())))
      .catch(() => {})
    // 公告：失败静默，就当没有
    fetchAnnounce()
      .then((r) => setAnnounce(r.text))
      .catch(() => {})
    api.authGet()
      .then((a: AuthSession | null) => {
        setAuth(a)
        if (!a) return
        // 已登录：进页面即拉一次权益并落缓存；失败只提示，不影响页面其他功能
        fetchEntitlement(a.token)
          .then((r) => {
            setEntitlement(r.entitlement)
            void api.entitlementSet(cacheEntitlement(r.entitlement, Date.now()))
          })
          .catch((e) =>
            setAuthMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
          )
      })
      .catch(() => {})
  }, [])

  // 发送验证码成功后的 60s 重发倒计时
  useEffect(() => {
    if (codeCooldown <= 0) return
    const t = setTimeout(() => setCodeCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [codeCooldown])

  /** 发送登录验证码：成功后进入 60s 重发倒计时 */
  const sendAuthCode = async (): Promise<void> => {
    const em = authEmail.trim()
    if (!em || codeSending || codeCooldown > 0) return
    setCodeSending(true)
    setAuthMsg(null)
    try {
      const r = await requestCode(em)
      setCodeCooldown(60)
      // DEV_MODE 下服务端直接回传验证码，联调时免查邮箱
      setAuthMsg({
        ok: true,
        text: r.devCode ? `验证码已发送（开发模式：${r.devCode}）` : '验证码已发送，请查收邮箱'
      })
    } catch (e) {
      setAuthMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setCodeSending(false)
    }
  }

  /** 验证码登录：成功即落库会话与权益缓存，并拉远端偏好（服务器为准）应用到本地 */
  const doLogin = async (): Promise<void> => {
    const em = authEmail.trim()
    const code = authCode.trim()
    if (!em || !code || loggingIn) return
    setLoggingIn(true)
    setAuthMsg(null)
    try {
      const r = await login(em, code)
      const session: AuthSession = { email: em, token: r.token }
      await api.authSet(session)
      await api.entitlementSet(cacheEntitlement(r.entitlement, Date.now()))
      setAuth(session)
      setEntitlement(r.entitlement)
      setAuthCode('')
      setAuthMsg({ ok: true, text: '登录成功' })
      // 远端有同步过的偏好则覆盖本地（静默失败，不影响登录结果）
      await pullPrefsToSettings(r.token)
    } catch (e) {
      setAuthMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setLoggingIn(false)
    }
  }

  /** 手动刷新权益：成功同步写本地缓存 */
  const refreshEnt = async (): Promise<void> => {
    if (!auth || entRefreshing) return
    setEntRefreshing(true)
    setAuthMsg(null)
    try {
      const r = await fetchEntitlement(auth.token)
      await api.entitlementSet(cacheEntitlement(r.entitlement, Date.now()))
      setEntitlement(r.entitlement)
      setAuthMsg({ ok: true, text: '权益已刷新' })
    } catch (e) {
      setAuthMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setEntRefreshing(false)
    }
  }

  /** 兑换卡密：成功提示兑换后的新档位，并写入权益缓存 */
  const redeem = async (): Promise<void> => {
    const code = cardCode.trim()
    if (!auth || !code || redeeming) return
    setRedeeming(true)
    setAuthMsg(null)
    try {
      const r = await redeemCard(auth.token, code)
      await api.entitlementSet(cacheEntitlement(r.entitlement, Date.now()))
      setEntitlement(r.entitlement)
      setCardCode('')
      setAuthMsg({ ok: true, text: `兑换成功，当前档位：${PLAN_LABEL[r.entitlement.plan]}` })
    } catch (e) {
      setAuthMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setRedeeming(false)
    }
  }

  /** 登出：清除落库会话、权益缓存与内存态权益（防止换号继承宽限期内的付费档） */
  const logout = async (): Promise<void> => {
    await api.authSet(null)
    await api.entitlementSet(null)
    setAuth(null)
    setEntitlement(null)
    setAuthCode('')
    setCardCode('')
    setAuthMsg(null)
  }

  // 生效档位：在线以服务端拉到的权益为准；拉不到（离线）回落本地缓存宽限
  const effectivePlan: Plan = entitlement?.plan ?? gracePlan
  const canSubmitChannel = !!auth && isPaidPlan(effectivePlan)

  /** 提交自定义频道（pro 起，服务端强制）：pending=待审核，approved=已在库 */
  const submitChannelHandle = async (): Promise<void> => {
    const h = channelHandle.trim()
    if (!auth || !h || channelSubmitting || !canSubmitChannel) return
    setChannelSubmitting(true)
    setChannelMsg(null)
    try {
      const r = await submitChannel(auth.token, h)
      setChannelHandle('')
      setChannelMsg({
        ok: true,
        text: r.status === 'approved' ? '该频道已在库中' : '已提交，待审核'
      })
    } catch (e) {
      setChannelMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setChannelSubmitting(false)
    }
  }

  return (
    <PageShell title="我的" desc="账号登录、会员权益与订阅管理">
      <div className="settings-group">
        <div className="group-head">
          <span className="group-title">账号与权益</span>
          <span className="card-note">邮箱验证码登录，无需密码</span>
        </div>
        <section className="settings-card">
        {!auth ? (
          <>
            <div className="field-label">邮箱</div>
            <div className="pipe-test">
              <TextInput
                value={authEmail}
                onChange={(e) => setAuthEmail(e.currentTarget.value)}
                placeholder="you@example.com"
                style={{ flex: 1 }}
              />
              <Button
                variant="light"
                loading={codeSending}
                disabled={!authEmail.trim() || codeCooldown > 0}
                onClick={() => void sendAuthCode()}
              >
                {codeCooldown > 0 ? `重发（${codeCooldown}s）` : '发送验证码'}
              </Button>
            </div>
            <div className="field-label">验证码</div>
            <div className="pipe-test">
              <TextInput
                value={authCode}
                onChange={(e) => setAuthCode(e.currentTarget.value)}
                onKeyDown={(e) => e.key === 'Enter' && void doLogin()}
                placeholder="邮件中的 6 位验证码"
                style={{ flex: 1 }}
              />
              <Button
                variant="light"
                loading={loggingIn}
                disabled={!authCode.trim()}
                onClick={() => void doLogin()}
              >
                登录
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="auth-row">
              <span className="engine-info">
                <span className="engine-name">{auth.email}</span>
                <span className="engine-hint">当前登录账号</span>
              </span>
              <Button variant="subtle" color="red" onClick={() => void logout()}>
                登出
              </Button>
            </div>
            <div className="auth-row">
              <span className="engine-info">
                <span className="engine-name">
                  当前权益：{entitlement ? PLAN_LABEL[entitlement.plan] : '获取中…'}
                </span>
                <span className="engine-hint">
                  到期时间：
                  {entitlement?.expiresAt
                    ? new Date(entitlement.expiresAt).toLocaleString()
                    : '—'}
                </span>
              </span>
              <Button variant="light" loading={entRefreshing} onClick={() => void refreshEnt()}>
                刷新权益
              </Button>
            </div>
            <div className="card-divider" />
            <div className="field-label">卡密兑换</div>
            <div className="pipe-test">
              <TextInput
                value={cardCode}
                onChange={(e) => setCardCode(e.currentTarget.value)}
                onKeyDown={(e) => e.key === 'Enter' && void redeem()}
                placeholder="输入卡密，兑换会员时长"
                style={{ flex: 1 }}
              />
              <Button
                variant="light"
                loading={redeeming}
                disabled={!cardCode.trim()}
                onClick={() => void redeem()}
              >
                兑换
              </Button>
            </div>
          </>
        )}
        {authMsg && (
          <div className={authMsg.ok ? 'saved-hint auth-msg' : 'llm-test-fail auth-msg'}>
            {authMsg.text}
          </div>
        )}
        </section>
      </div>

      {/* C1 自定义频道订阅（pro 起）：审核通过后随下次内容更新进入精选推荐 */}
      <div className="settings-group" style={{ marginTop: 16 }}>
        <div className="group-head">
          <span className="group-title">自定义频道订阅</span>
          <span className="card-note">pro 及以上可用</span>
        </div>
        <section className="settings-card">
        <div className="engine-hint">
          提交你想看的 YouTube 频道，审核通过后随下次内容更新进入精选推荐
        </div>
        <div className="pipe-test" style={{ marginTop: 10 }}>
          <TextInput
            value={channelHandle}
            onChange={(e) => setChannelHandle(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submitChannelHandle()}
            placeholder="@频道名 或频道链接"
            disabled={!canSubmitChannel}
            style={{ flex: 1 }}
          />
          <Button
            variant="light"
            loading={channelSubmitting}
            disabled={!canSubmitChannel || !channelHandle.trim()}
            onClick={() => void submitChannelHandle()}
          >
            提交
          </Button>
        </div>
        {!canSubmitChannel && (
          <div className="engine-hint auth-msg">
            {auth ? 'pro 及以上可用，兑换卡密升级后即可提交' : 'pro 及以上可用，请先登录'}
          </div>
        )}
        {channelMsg && (
          <div className={channelMsg.ok ? 'saved-hint auth-msg' : 'llm-test-fail auth-msg'}>
            {channelMsg.text}
          </div>
        )}
        </section>
      </div>

      {/* 服务端公告（页面最下方）：空串不渲染，文案原样输出支持换行 */}
      {announce && <div className="profile-announce">{announce}</div>}
    </PageShell>
  )
}
