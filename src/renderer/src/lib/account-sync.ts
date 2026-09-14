/**
 * 账号侧同步助手：权益缓存落库 + 精选偏好双端同步。
 * 所有失败（离线/403/服务端错误）一律静默——本地数据已生效，不同步只是不上云。
 */
import { api } from '../api'
import { AuthSession, CuratedPrefs, fetchEntitlement, getPrefs, putPrefs } from '../../../shared/auth-api'
import { CachedEntitlement, cacheEntitlement, effectiveCachedPlan, isPaidPlan } from '../../../shared/entitlement'
import { CefrLevel } from '../../../shared/types'

/** 在线拉权益并写入本地缓存（App 启动 / 进精选页时调用）；失败返回 null（离线静默，靠 graceDays 宽限） */
export async function syncEntitlementCache(token: string): Promise<CachedEntitlement | null> {
  try {
    const { entitlement } = await fetchEntitlement(token)
    const cached = cacheEntitlement(entitlement, Date.now())
    await api.entitlementSet(cached)
    return cached
  } catch {
    /* 离线静默：本地缓存继续按宽限期生效 */
    return null
  }
}

/**
 * 拉远端偏好应用到本地设置；未同步过/失败静默。
 * MVP 简化策略：服务器为准整体覆盖本地，不做多端按域合并。
 */
export async function pullPrefsToSettings(token: string): Promise<void> {
  try {
    const { prefs } = await getPrefs(token)
    if (!prefs) return
    await api.settingsSet({
      curatedLevel: (prefs.curatedLevel as CefrLevel | null) ?? null,
      curatedTags: prefs.curatedTags ?? []
    })
  } catch {
    /* 失败静默：本地设置照常使用 */
  }
}

// 偏好上传防抖：连续调整水平/标签时只发最后一次
let prefsPushTimer: number | null = null

/** 修改精选偏好后调用：防抖 1s；仅登录且付费档才上云（服务端强制，免费档 403 静默） */
export function schedulePrefsPush(curatedLevel: CefrLevel | null, curatedTags: string[]): void {
  if (prefsPushTimer) window.clearTimeout(prefsPushTimer)
  prefsPushTimer = window.setTimeout(() => {
    void (async () => {
      try {
        const auth: AuthSession | null = await api.authGet()
        if (!auth) return
        const cached = await api.entitlementGet()
        if (!isPaidPlan(effectiveCachedPlan(cached, Date.now()))) return
        const prefs: CuratedPrefs = { curatedLevel, curatedTags, updatedAt: Date.now() }
        await putPrefs(auth.token, prefs)
      } catch {
        /* 403/网络失败静默：本地设置已生效 */
      }
    })()
  }, 1000)
}
