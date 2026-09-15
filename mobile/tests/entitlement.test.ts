import AsyncStorage from '@react-native-async-storage/async-storage'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  cacheEntitlement,
  effectiveCachedPlan,
  isPaidPlan,
  loadEntitlementCache,
  saveEntitlementCache
} from '../src/lib/entitlement'
import { __resetAsyncStorage } from './mocks/async-storage'

// 纯函数部分移植自根仓库 tests/entitlement.test.ts（两端逻辑逐行一致）；
// AsyncStorage 持久化部分用内存 mock（vitest.config.ts alias）补测。

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

describe('loadEntitlementCache / saveEntitlementCache（内存 mock AsyncStorage）', () => {
  beforeEach(() => __resetAsyncStorage())

  it('保存后可读回；传 null 清除', async () => {
    const c = cache('pro', NOW)
    await saveEntitlementCache(c)
    expect(await loadEntitlementCache()).toEqual(c)
    await saveEntitlementCache(null)
    expect(await loadEntitlementCache()).toBeNull()
  })

  it('无缓存 / 坏 JSON / 缺字段 → null', async () => {
    expect(await loadEntitlementCache()).toBeNull()
    await AsyncStorage.setItem('ytensub:entitlement-v1', 'not json')
    expect(await loadEntitlementCache()).toBeNull()
    await AsyncStorage.setItem('ytensub:entitlement-v1', JSON.stringify({ plan: 1 }))
    expect(await loadEntitlementCache()).toBeNull()
  })

  it('读回的缓存可直接参与宽限判定', async () => {
    await saveEntitlementCache(cache('pro_plus', NOW - 8 * 86_400_000))
    expect(effectiveCachedPlan(await loadEntitlementCache(), NOW)).toBe('free')
  })
})
