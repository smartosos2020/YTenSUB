import { describe, expect, it } from 'vitest'
import { buildShadowingMessages, parseShadowingResponse } from '../src/main/shadowing'

describe('parseShadowingResponse', () => {
  it('解析合法 JSON 数组，按序号排序', () => {
    const raw = '[{"i": 5, "text": "How are you?"}, {"i": 2, "text": "Nice to meet you."}]'
    expect(parseShadowingResponse(raw, 10)).toEqual([
      { i: 2, text: 'Nice to meet you.' },
      { i: 5, text: 'How are you?' }
    ])
  })

  it('容忍 JSON 前后的解释文字', () => {
    const raw = '好的，以下是结果：\n[{"i": 1, "text": "Sure thing."}]\n希望对你有帮助'
    expect(parseShadowingResponse(raw, 10)).toEqual([{ i: 1, text: 'Sure thing.' }])
  })

  it('丢弃越界序号、空文本、重复序号和非整数组', () => {
    const raw = '[{"i": 99, "text": "out"}, {"i": 1, "text": ""}, {"i": 2, "text": "a b c d"}, {"i": 2, "text": "dup"}, "junk"]'
    expect(parseShadowingResponse(raw, 10)).toEqual([{ i: 2, text: 'a b c d' }])
  })

  it('完全无法解析时返回空数组', () => {
    expect(parseShadowingResponse('no json here', 10)).toEqual([])
    expect(parseShadowingResponse('{"i":1}', 10)).toEqual([])
  })
})

describe('buildShadowingMessages', () => {
  it('user 消息包含带序号的字幕行', () => {
    const msgs = buildShadowingMessages([
      { start: 0, dur: 1, text: 'hello' },
      { start: 1, dur: 1, text: 'world' }
    ])
    expect(msgs).toHaveLength(2)
    expect(msgs[1].content).toBe('0. hello\n1. world')
  })
})
