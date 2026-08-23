import { describe, expect, it } from 'vitest'
import {
  alignCuesToEn,
  findActiveCueIndex,
  parseJson3Captions,
  toBilingualSrt
} from '../src/shared/captions'

describe('parseJson3Captions', () => {
  it('解析 json3 events 为 cue 数组', () => {
    const data = {
      events: [
        { tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: 'Hello ' }, { utf8: 'world' }] },
        { tStartMs: 3200, dDurationMs: 1800, segs: [{ utf8: 'Nice\nvideo' }] },
        { tStartMs: 5000, segs: [{ utf8: '\n' }] }, // 纯空白应被丢弃
        { tStartMs: 6000 } // 无 segs 应被丢弃
      ]
    }
    const cues = parseJson3Captions(data)
    expect(cues).toHaveLength(2)
    expect(cues[0]).toEqual({ start: 1, dur: 2, text: 'Hello world' })
    expect(cues[1]).toEqual({ start: 3.2, dur: 1.8, text: 'Nice video' })
  })

  it('非法输入返回空数组', () => {
    expect(parseJson3Captions(null)).toEqual([])
    expect(parseJson3Captions({})).toEqual([])
  })
})

describe('findActiveCueIndex', () => {
  const cues = [
    { start: 0, dur: 2, text: 'a' },
    { start: 2.5, dur: 2, text: 'b' },
    { start: 5, dur: 2, text: 'c' }
  ]

  it('命中区间内的 cue', () => {
    expect(findActiveCueIndex(cues, 0)).toBe(0)
    expect(findActiveCueIndex(cues, 3)).toBe(1)
    expect(findActiveCueIndex(cues, 6.9)).toBe(2)
  })

  it('间隙中保留 0.5s 宽限', () => {
    // a 在 2.0 结束，2.2 仍在宽限内
    expect(findActiveCueIndex(cues, 2.2)).toBe(0)
    // 2.6 已超出 a 的宽限，但下一句 b 从 2.5 开始 → b
    expect(findActiveCueIndex(cues, 2.6)).toBe(1)
  })

  it('超出宽限且下一句未开始返回 -1', () => {
    const sparse = [
      { start: 0, dur: 1, text: 'x' },
      { start: 10, dur: 1, text: 'y' }
    ]
    expect(findActiveCueIndex(sparse, 3)).toBe(-1)
  })

  it('开头之前返回 -1', () => {
    expect(findActiveCueIndex([{ start: 5, dur: 1, text: 'x' }], 1)).toBe(-1)
  })
})

describe('alignCuesToEn', () => {
  it('按时间重叠把中文对齐到英文，重叠多条顺序拼接', () => {
    const en = [
      { start: 0, dur: 2, text: 'a' },
      { start: 2, dur: 2, text: 'b' },
      { start: 10, dur: 1, text: 'c' }
    ]
    const zh = [
      { start: 0, dur: 1, text: '甲' },
      { start: 1, dur: 2.5, text: '乙' }
    ]
    // a[0,2) 与 甲[0,1) 乙[1,3.5) 都相交；b[2,4) 只与 乙 相交；c 无重叠
    expect(alignCuesToEn(en, zh)).toEqual(['甲 乙', '乙', null])
  })

  it('结果与英文字幕等长，中文为空时全为 null', () => {
    const en = [
      { start: 0, dur: 1, text: 'a' },
      { start: 1, dur: 1, text: 'b' }
    ]
    expect(alignCuesToEn(en, [])).toEqual([null, null])
  })

  it('时长为 0 的 cue 按 0.4s 参与重叠', () => {
    const en = [{ start: 1, dur: 0, text: 'a' }]
    const zh = [{ start: 1.2, dur: 0, text: '甲' }]
    expect(alignCuesToEn(en, zh)).toEqual(['甲'])
  })
})

describe('toBilingualSrt', () => {
  it('生成带时间轴的双语 SRT，中文缺失时只有英文行', () => {
    const cues = [
      { start: 1.5, dur: 2, text: 'Hello' },
      { start: 4, dur: 0, text: 'World' }
    ]
    const srt = toBilingualSrt(cues, ['你好', null])
    expect(srt).toContain('1\n00:00:01,500 --> 00:00:03,500\nHello\n你好')
    // 时长为 0 按 0.4s 计
    expect(srt).toContain('2\n00:00:04,000 --> 00:00:04,400\nWorld')
    expect(srt.endsWith('\n')).toBe(true)
  })
})
