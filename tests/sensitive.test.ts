import { describe, expect, it } from 'vitest'
import { filterSensitiveVideos, isSensitiveVideo } from '../src/shared/sensitive'

describe('isSensitiveVideo', () => {
  it('News & Politics 官方分类命中', () => {
    expect(isSensitiveVideo({ ytCategory: 'News & Politics' })).toBe(true)
  })
  it('"新闻"标签命中', () => {
    expect(isSensitiveVideo({ tags: ['新闻'] })).toBe(true)
    expect(isSensitiveVideo({ tags: ['教育', '科技'] })).toBe(false)
  })
  it('频道名单命中', () => {
    expect(isSensitiveVideo({ channel: 'DW News' })).toBe(true)
    expect(isSensitiveVideo({ channel: 'Kurzgesagt – In a Nutshell' })).toBe(false)
  })
  it('标题关键词命中（大小写不敏感）', () => {
    expect(isSensitiveVideo({ title: 'How the US Election Works' })).toBe(true)
    expect(isSensitiveVideo({ title: 'Trump signs new tariff order' })).toBe(true)
    expect(isSensitiveVideo({ title: '加沙战争一周年' })).toBe(true)
  })
  it('普通学习内容不误伤', () => {
    expect(
      isSensitiveVideo({
        title: 'AEE - Socializing in English: Are You a Coconut or a Peach?',
        channel: 'All Ears English',
        tags: ['教育'],
        ytCategory: 'Education'
      })
    ).toBe(false)
    expect(isSensitiveVideo({ title: 'The science of sleep', channel: 'Veritasium' })).toBe(false)
  })
  it('空对象不炸', () => {
    expect(isSensitiveVideo({})).toBe(false)
  })
})

describe('filterSensitiveVideos', () => {
  const list = [
    { title: 'How the US Election Works' },
    { title: 'Learn English idioms' }
  ]
  it('开关开：过滤', () => {
    expect(filterSensitiveVideos(list, true)).toHaveLength(1)
  })
  it('开关关：原样', () => {
    expect(filterSensitiveVideos(list, false)).toHaveLength(2)
  })
})
