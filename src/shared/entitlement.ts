/**
 * 权益本地缓存与离线宽限（D5）：
 * 在线时以服务端 /me/entitlement 为准；网络失败时，verifiedAt 距现在不超过
 * graceDays 天就信任缓存档位，超过则回落 free（fail closed）。
 * 桌面端与手机端共用（手机端在 mobile/src/lib/ 放同步拷贝）。
 */
import type { Entitlement, Plan } from './auth-api'

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
