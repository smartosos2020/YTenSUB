import { describe, expect, it, vi } from 'vitest'

// 强制 wink-lemmatizer 抛错，验证 mobile 版相对桌面新增的兜底逻辑：
// 原样返回（小写去空白）+ 失败日志经 sink 上报且同一词只报一次。
vi.mock('wink-lemmatizer', () => ({
  default: {
    verb: () => {
      throw new Error('boom')
    },
    noun: () => {
      throw new Error('boom')
    },
    adjective: () => {
      throw new Error('boom')
    }
  }
}))

import { lemmatize, setLemmatizeErrorSink } from '../src/lib/lemma'

describe('lemmatize 兜底（词元化器抛错）', () => {
  it('失败时原样返回，同一词日志只报一次', () => {
    const sink = vi.fn()
    setLemmatizeErrorSink(sink)
    expect(lemmatize(' ThrowMe ')).toBe('throwme')
    expect(lemmatize('throwme')).toBe('throwme')
    expect(sink).toHaveBeenCalledTimes(1)
    expect(String(sink.mock.calls[0][0])).toContain('throwme')
  })
})
