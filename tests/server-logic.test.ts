import { describe, expect, it } from 'vitest'
import {
  UserRecord,
  applyCard,
  chooseMailProvider,
  effectivePlan,
  grantPlan,
  isValidCardCode,
  isValidEmail,
  isValidVideoId,
  makeCardCode,
  mergePrefs,
  normalizeCardCode,
  normalizeChannelHandle,
  resolveFilterSensitive,
  revokePlan,
  sanitizeAnnounce,
  sanitizePrefs,
  toEntitlement
} from '../server/src/logic'

const NOW = 1_790_000_000_000

function user(plan: UserRecord['plan'], expiresAt: number | null): UserRecord {
  return { email: 'a@b.co', plan, expiresAt, createdAt: NOW, updatedAt: NOW }
}

describe('effectivePlan', () => {
  it('免费用户恒为 free', () => {
    expect(effectivePlan(user('free', null), NOW)).toBe('free')
  })
  it('未到期付费档生效', () => {
    expect(effectivePlan(user('pro', NOW + 1000), NOW)).toBe('pro')
  })
  it('已过期回落 free（不改存储记录）', () => {
    const u = user('pro_plus', NOW - 1)
    expect(effectivePlan(u, NOW)).toBe('free')
    expect(u.plan).toBe('pro_plus')
  })
})

describe('applyCard', () => {
  const proCard = { code: 'YTS-AAAA-AAAA-AAAA', plan: 'pro' as const, days: 365 }
  const plusCard = { code: 'YTS-BBBB-BBBB-BBBB', plan: 'pro_plus' as const, days: 30 }

  it('免费用户兑卡：从当前时间起算', () => {
    const u = applyCard(user('free', null), proCard, NOW)
    expect(u.plan).toBe('pro')
    expect(u.expiresAt).toBe(NOW + 365 * 86_400_000)
  })
  it('在期用户兑卡：从现有到期顺延', () => {
    const u = applyCard(user('pro', NOW + 10 * 86_400_000), proCard, NOW)
    expect(u.expiresAt).toBe(NOW + 375 * 86_400_000)
  })
  it('pro+ 在期兑 pro 卡：保留高档位只延时间', () => {
    const u = applyCard(user('pro_plus', NOW + 5 * 86_400_000), proCard, NOW)
    expect(u.plan).toBe('pro_plus')
    expect(u.expiresAt).toBe(NOW + 370 * 86_400_000)
  })
  it('pro 在期兑 pro+ 卡：升档', () => {
    const u = applyCard(user('pro', NOW + 5 * 86_400_000), plusCard, NOW)
    expect(u.plan).toBe('pro_plus')
  })
  it('过期 pro+ 兑 pro 卡：按卡面档位', () => {
    const u = applyCard(user('pro_plus', NOW - 1000), proCard, NOW)
    expect(u.plan).toBe('pro')
  })
})

describe('卡密格式', () => {
  it('生成格式 YTS-XXXX-XXXX-XXXX 且不含易混淆字符', () => {
    for (let i = 0; i < 50; i++) {
      const code = makeCardCode(Math.random)
      expect(isValidCardCode(code)).toBe(true)
      expect(code).not.toMatch(/[01IOL]/)
    }
  })
  it('normalize：去空白 + 大写', () => {
    expect(normalizeCardCode('  yts-aaaa-aaaa-aaaa ')).toBe('YTS-AAAA-AAAA-AAAA')
  })
  it('拒绝错误格式', () => {
    expect(isValidCardCode('YTS-AAAA-AAAA')).toBe(false)
    expect(isValidCardCode('AAAA-AAAA-AAAA-AAAA')).toBe(false)
  })
})

describe('邮箱校验', () => {
  it('常规邮箱通过', () => {
    expect(isValidEmail('a@b.co')).toBe(true)
  })
  it('缺 @ / 空串拒绝', () => {
    expect(isValidEmail('ab.co')).toBe(false)
    expect(isValidEmail('')).toBe(false)
  })
})

describe('chooseMailProvider', () => {
  it('Resend 优先，SendGrid 兜底，都没配返回 null', () => {
    expect(chooseMailProvider({ RESEND_API_KEY: 'x', SENDGRID_API_KEY: 'y' })).toBe('resend')
    expect(chooseMailProvider({ SENDGRID_API_KEY: 'y' })).toBe('sendgrid')
    expect(chooseMailProvider({})).toBe(null)
  })
})

describe('sanitizePrefs', () => {
  it('合法输入原样通过', () => {
    expect(
      sanitizePrefs({ curatedLevel: 'B1', curatedTags: ['教育', '科技'], updatedAt: NOW }, NOW)
    ).toEqual({ curatedLevel: 'B1', curatedTags: ['教育', '科技'], updatedAt: NOW })
  })
  it('level 非法 / tags 非数组 → null', () => {
    expect(sanitizePrefs({ curatedLevel: 'Z9', curatedTags: [] }, NOW)).toBe(null)
    expect(sanitizePrefs({ curatedLevel: null, curatedTags: 'x' }, NOW)).toBe(null)
    expect(sanitizePrefs('junk', NOW)).toBe(null)
  })
  it('tags 去重 + 过滤非字符串 + 限量；updatedAt 缺失取当前时间', () => {
    const p = sanitizePrefs({ curatedLevel: null, curatedTags: ['教育', '教育', 42, '科技'] }, NOW)
    expect(p).toEqual({ curatedLevel: null, curatedTags: ['教育', '科技'], updatedAt: NOW })
  })
})

describe('mergePrefs', () => {
  it('updatedAt 新者胜', () => {
    const a = { curatedLevel: 'A1', curatedTags: [], updatedAt: 100 }
    const b = { curatedLevel: 'C2', curatedTags: ['x'], updatedAt: 200 }
    expect(mergePrefs(a, b)).toBe(b)
    expect(mergePrefs(b, a)).toBe(b)
  })
  it('一侧为 null 取另一侧', () => {
    const a = { curatedLevel: 'A1', curatedTags: [], updatedAt: 100 }
    expect(mergePrefs(a, null)).toBe(a)
    expect(mergePrefs(null, a)).toBe(a)
  })
})

describe('normalizeChannelHandle', () => {
  it('裸 handle 补 @', () => {
    expect(normalizeChannelHandle('BobTheCanadian')).toBe('@BobTheCanadian')
  })
  it('@handle 与 URL 形式归一', () => {
    expect(normalizeChannelHandle('@BobTheCanadian')).toBe('@BobTheCanadian')
    expect(normalizeChannelHandle('https://www.youtube.com/@BobTheCanadian')).toBe('@BobTheCanadian')
  })
  it('UC 开头 channelId 原样通过', () => {
    expect(normalizeChannelHandle('UCmIi3b8V1n5g8h0a1b2c3d4'.slice(0, 24))).toBe('UCmIi3b8V1n5g8h0a1b2c3d4'.slice(0, 24))
  })
  it('非法输入返回 null', () => {
    expect(normalizeChannelHandle('')).toBe(null)
    expect(normalizeChannelHandle('https://youtube.com/')).toBe(null)
    expect(normalizeChannelHandle('a')).toBe(null)
  })
})

describe('isValidVideoId', () => {
  it('11 位合法字符通过', () => {
    expect(isValidVideoId('dQw4w9WgXcQ')).toBe(true)
  })
  it('长度/字符非法拒绝', () => {
    expect(isValidVideoId('short')).toBe(false)
    expect(isValidVideoId('dQw4w9WgXcQ!')).toBe(false)
  })
})

describe('grantPlan / revokePlan', () => {
  it('手动开通：从 max(now, 到期) 顺延，等价兑卡', () => {
    const u = grantPlan(user('free', null), 'pro', 30, NOW)
    expect(u.plan).toBe('pro')
    expect(u.expiresAt).toBe(NOW + 30 * 86_400_000)
    const v = grantPlan(u, 'pro_plus', 10, NOW)
    expect(v.plan).toBe('pro_plus')
    expect(v.expiresAt).toBe(NOW + 40 * 86_400_000)
  })
  it('吊销：回落 free 清到期，其他字段保留', () => {
    const u = { ...user('pro', NOW + 1000), filterSensitive: false }
    const v = revokePlan(u, NOW)
    expect(v.plan).toBe('free')
    expect(v.expiresAt).toBe(null)
    expect(v.filterSensitive).toBe(false)
    expect(effectivePlan(v, NOW)).toBe('free')
  })
})

describe('sanitizeAnnounce', () => {
  it('去首尾空白，保留正文', () => {
    expect(sanitizeAnnounce('  购买加微信 abc  ')).toBe('购买加微信 abc')
  })
  it('空串/纯空白 → null（客户端隐藏）', () => {
    expect(sanitizeAnnounce('')).toBe(null)
    expect(sanitizeAnnounce('   ')).toBe(null)
  })
  it('非字符串 → null；超 500 字截断', () => {
    expect(sanitizeAnnounce(42)).toBe(null)
    expect(sanitizeAnnounce('x'.repeat(600))).toHaveLength(500)
  })
})

describe('toEntitlement', () => {
  it('携带 graceDays 与原始到期时间', () => {
    const e = toEntitlement(user('pro', NOW + 1), NOW, 7)
    expect(e).toEqual({ plan: 'pro', expiresAt: NOW + 1, graceDays: 7, filterSensitive: true })
  })
})

describe('resolveFilterSensitive', () => {
  it('未设置覆盖 → 跟随全局', () => {
    expect(resolveFilterSensitive(user('free', null), true)).toBe(true)
    expect(resolveFilterSensitive(user('free', null), false)).toBe(false)
  })
  it('用户级覆盖优先于全局', () => {
    const on = { ...user('free', null), filterSensitive: true }
    const off = { ...user('free', null), filterSensitive: false }
    expect(resolveFilterSensitive(on, false)).toBe(true)
    expect(resolveFilterSensitive(off, true)).toBe(false)
  })
  it('显式 null = 跟随全局', () => {
    const u = { ...user('free', null), filterSensitive: null }
    expect(resolveFilterSensitive(u, false)).toBe(false)
  })
  it('toEntitlement 叠加用户覆盖', () => {
    const u = { ...user('pro', NOW + 1), filterSensitive: false }
    expect(toEntitlement(u, NOW, 7, true).filterSensitive).toBe(false)
  })
})
