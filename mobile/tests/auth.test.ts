import AsyncStorage from '@react-native-async-storage/async-storage'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  authCache,
  loadPrefsCache,
  loadSession,
  savePrefsCache,
  saveSession,
  type CuratedPrefs
} from '../src/lib/auth'
import { __resetAsyncStorage } from './mocks/async-storage'

// 只测 AsyncStorage 持久化与数据校验部分（内存 mock，见 vitest.config.ts alias）；
// requestCode / login / redeemCard 等 fetch 网络函数不测。

beforeEach(() => __resetAsyncStorage())

describe('loadSession / saveSession', () => {
  it('无数据 / 坏 JSON / 缺字段 → null', async () => {
    expect(await loadSession()).toBeNull()
    await AsyncStorage.setItem('ytensub:auth-v1', 'not json')
    expect(await loadSession()).toBeNull()
    await AsyncStorage.setItem('ytensub:auth-v1', JSON.stringify({ email: 1, token: 't' }))
    expect(await loadSession()).toBeNull()
  })

  it('保存后可读回；saveSession(null) 清除（登出）', async () => {
    const s = { email: 'a@b.c', token: 'tok' }
    await saveSession(s)
    expect(await loadSession()).toEqual(s)
    await saveSession(null)
    expect(await loadSession()).toBeNull()
  })
})

describe('loadPrefsCache / savePrefsCache', () => {
  it('保存后可读回；形状不符 → null', async () => {
    expect(await loadPrefsCache()).toBeNull()
    const p: CuratedPrefs = { curatedLevel: 'B1', curatedTags: ['科技'], updatedAt: 1 }
    await savePrefsCache(p)
    expect(await loadPrefsCache()).toEqual(p)
    await AsyncStorage.setItem(
      'ytensub:prefs-v1',
      JSON.stringify({ curatedTags: 'not-array', updatedAt: 1 })
    )
    expect(await loadPrefsCache()).toBeNull()
  })

  it('savePrefsCache(null) 清除', async () => {
    await savePrefsCache({ curatedLevel: null, curatedTags: [], updatedAt: 1 })
    await savePrefsCache(null)
    expect(await loadPrefsCache()).toBeNull()
  })
})

describe('authCache', () => {
  it('初始为空（启动后由 primeAuth 填充）', () => {
    expect(authCache).toEqual({ session: null, entitlement: null })
  })
})
