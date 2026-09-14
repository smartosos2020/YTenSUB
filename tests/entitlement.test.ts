import { describe, expect, it } from 'vitest'
import { cacheEntitlement, effectiveCachedPlan, isPaidPlan } from '../src/shared/entitlement'

const NOW = 1_790_000_000_000

function cache(plan: 'free' | 'pro' | 'pro_plus', verifiedAt: number, graceDays = 7) {
  return cacheEntitlement({ plan, expiresAt: null, graceDays }, verifiedAt)
}

describe('effectiveCachedPlan', () => {
  it('无缓存 / free 档 → free', () => {
    expect(effectiveCachedPlan(null, NOW)).toBe('free')
    expect(effectiveCachedPlan(cache('free', NOW), NOW)).toBe('free')
  })
  it('宽限期内信任缓存档位', () => {
    const c = cache('pro', NOW - 3 * 86_400_000) // 3 天前验证
    expect(effectiveCachedPlan(c, NOW)).toBe('pro')
  })
  it('超过宽限期回落 free（fail closed）', () => {
    const c = cache('pro_plus', NOW - 8 * 86_400_000) // 8 天前验证，宽限 7 天
    expect(effectiveCachedPlan(c, NOW)).toBe('free')
  })
  it('宽限期边界：恰好等于视为有效', () => {
    const c = cache('pro', NOW - 7 * 86_400_000)
    expect(effectiveCachedPlan(c, NOW)).toBe('pro')
  })
  it('graceDays 以服务端最近一次下发为准', () => {
    const c = cache('pro', NOW - 10 * 86_400_000, 14) // 宽限被服务端调到 14 天
    expect(effectiveCachedPlan(c, NOW)).toBe('pro')
  })
})

describe('isPaidPlan', () => {
  it('free 非付费，其余付费', () => {
    expect(isPaidPlan('free')).toBe(false)
    expect(isPaidPlan('pro')).toBe(true)
    expect(isPaidPlan('pro_plus')).toBe(true)
  })
})
