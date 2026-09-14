/**
 * 权益本地缓存与离线宽限（D5）：与桌面端 src/shared/entitlement.ts 同源（同步拷贝）。
 * 在线时以服务端 /me/entitlement 为准；网络失败时，verifiedAt 距现在不超过
 * graceDays 天就信任缓存档位，超过则回落 free（fail closed）。
 * 下半部分是手机端新增：AsyncStorage 持久化。
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { Entitlement, Plan } from './auth'

export interface CachedEntitlement extends Entitlement {
  /** 最近一次成功向服务端求证的时间（ms） */
  verifiedAt: number
}

/** 免费用户每天可看的精选部数（按 rankCurated 排序取前 N） */
export const FREE_DAILY_QUOTA = 3

export function cacheEntitlement(e: Entitlement, now: number): CachedEntitlement {
  return { ...e, verifiedAt: now }
}

/** 当前可用档位：无缓存/超宽限期 → free */
export function effectiveCachedPlan(cache: CachedEntitlement | null, now: number): Plan {
  if (!cache || cache.plan === 'free') return 'free'
  if (now - cache.verifiedAt > cache.graceDays * 86_400_000) return 'free'
  return cache.plan
}

export function isPaidPlan(plan: Plan): boolean {
  return plan !== 'free'
}

/* ---------- 以下为手机端新增 ---------- */

const ENTITLEMENT_KEY = 'ytensub:entitlement-v1'

/** 读取本地权益缓存；无或数据损坏返回 null */
export async function loadEntitlementCache(): Promise<CachedEntitlement | null> {
  try {
    const raw = await AsyncStorage.getItem(ENTITLEMENT_KEY)
    if (!raw) return null
    const c = JSON.parse(raw) as CachedEntitlement
    return typeof c.plan === 'string' && typeof c.verifiedAt === 'number' ? c : null
  } catch {
    return null
  }
}

/** 保存/清除本地权益缓存（传 null = 登出清除） */
export async function saveEntitlementCache(c: CachedEntitlement | null): Promise<void> {
  try {
    if (c) await AsyncStorage.setItem(ENTITLEMENT_KEY, JSON.stringify(c))
    else await AsyncStorage.removeItem(ENTITLEMENT_KEY)
  } catch {
    /* 持久化失败不阻塞界面 */
  }
}
