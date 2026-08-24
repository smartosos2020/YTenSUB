import { describe, expect, it } from 'vitest'
import {
  buildShadowingMessages,
  cleanShadowingText,
  mergeCuesToSentences,
  parseShadowingResponse,
  ruleBasedPick,
  withSceneNumbers
} from '../src/main/shadowing'

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
    const msgs = buildShadowingMessages([{ text: 'hello' }, { text: 'world' }])
    expect(msgs).toHaveLength(2)
    expect(msgs[1].content).toBe('0. hello\n1. world')
  })
})

describe('ruleBasedPick / cleanShadowingText', () => {
  it('清洗填充词和开头口头禅', () => {
    expect(cleanShadowingText('Um, so, you know, I think this is great.')).toBe('I think this is great.')
    expect(cleanShadowingText('Well, okay, let me explain this now')).toBe('let me explain this now')
  })

  it('过滤过短句，长视频均匀抽样', () => {
    const units = [
      { text: 'yeah' }, // 过短，应被过滤
      ...Array.from({ length: 40 }, (_, i) => ({
        text: `This is sentence number ${i} of the video.`
      }))
    ]
    const picked = ruleBasedPick(units, 15)
    expect(picked.length).toBe(15)
    expect(picked.every((p) => p.text !== 'yeah')).toBe(true)
    // 均匀抽样覆盖头尾
    expect(picked[0].i).toBeLessThan(5)
    expect(picked[14].i).toBeGreaterThan(35)
  })
})

describe('mergeCuesToSentences', () => {
  it('标点结尾断句并合并碎片', () => {
    const cues = [
      { start: 0, dur: 0.5, text: 'Hello,' },
      { start: 0.5, dur: 0.5, text: 'how are you?' },
      { start: 1.2, dur: 0.5, text: "I'm fine." }
    ]
    const out = mergeCuesToSentences(cues)
    expect(out).toEqual([
      { start: 0, end: 1, text: 'Hello, how are you?' },
      { start: 1.2, end: 1.7, text: "I'm fine." }
    ])
  })

  it('无标点（ASR 轨）按时间间隔断句', () => {
    const cues = [
      { start: 0, dur: 1, text: 'first part here' },
      { start: 1, dur: 1, text: 'still going' },
      { start: 5, dur: 1, text: 'new sentence' } // 间隔 3s > 1.5s
    ]
    const out = mergeCuesToSentences(cues)
    expect(out).toHaveLength(2)
    expect(out[0].text).toBe('first part here still going')
    expect(out[1].text).toBe('new sentence')
  })
})

describe('withSceneNumbers', () => {
  it('连续序号同场景，断开开新场景', () => {
    const picked = [
      { i: 1, text: 'a' },
      { i: 2, text: 'b' },
      { i: 3, text: 'c' },
      { i: 10, text: 'd' },
      { i: 11, text: 'e' },
      { i: 30, text: 'f' }
    ]
    expect(withSceneNumbers(picked)).toEqual([1, 1, 1, 2, 2, 3])
  })
})
