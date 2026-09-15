import { describe, expect, it } from 'vitest'
import {
  findActiveCueIndex,
  parseCaptionText,
  parseJson3Captions,
  parseSrvXml
} from '../src/lib/captions'

// parseJson3Captions / parseSrvXml / parseCaptionText / findActiveCueIndex 与根仓库
// tests/captions.test.ts、tests/srvxml.test.ts 行为一致（源码除文件头注释外完全相同，用例原样可过）。
// 桌面端的 alignCuesToEn / toBilingualSrt 在 mobile 拷贝中不存在（桌面专属），未移植。

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

describe('parseJson3Captions 与桌面端一致的细节行为', () => {
  it('json3 文本不做实体解码（原样保留；实体解码只在 srv XML 路径做）', () => {
    const data = { events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'a &amp; b' }] }] }
    expect(parseJson3Captions(data)).toEqual([{ start: 0, dur: 1, text: 'a &amp; b' }])
  })

  it('缺 tStartMs 的 event 按 start=0 保留', () => {
    const data = { events: [{ dDurationMs: 1000, segs: [{ utf8: 'hi' }] }] }
    expect(parseJson3Captions(data)).toEqual([{ start: 0, dur: 1, text: 'hi' }])
  })
})

describe('parseSrvXml', () => {
  it('解析 srv1 XML（含 <s> 子标签和实体）', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<timedtext format="3">
<body>
<p t="14000" d="2500"><s>Hello</s> <s>world,</s> <s>welcome</s></p>
<p t="16500" d="3000">It&#39;s a &quot;great&quot; day &amp; more</p>
<p t="19500" d="1000">   </p>
</body>
</timedtext>`
    const cues = parseSrvXml(xml)
    expect(cues).toHaveLength(2)
    expect(cues[0]).toEqual({ start: 14, dur: 2.5, text: 'Hello world, welcome' })
    expect(cues[1]).toEqual({ start: 16.5, dur: 3, text: `It's a "great" day & more` })
  })

  it('缺少 d 属性时 dur 为 0', () => {
    expect(parseSrvXml('<p t="1000">hi</p>')).toEqual([{ start: 1, dur: 0, text: 'hi' }])
  })
})

describe('parseCaptionText', () => {
  it('自动判别 json3', () => {
    const json3 = JSON.stringify({
      events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'hi' }] }]
    })
    expect(parseCaptionText(json3)).toEqual([{ start: 0, dur: 1, text: 'hi' }])
  })

  it('自动判别 XML', () => {
    expect(parseCaptionText('<timedtext><body><p t="0" d="500">yo</p></body></timedtext>')).toEqual([
      { start: 0, dur: 0.5, text: 'yo' }
    ])
  })

  it('空/坏输入返回空数组', () => {
    expect(parseCaptionText(null)).toEqual([])
    expect(parseCaptionText('')).toEqual([])
    expect(parseCaptionText('{bad json')).toEqual([])
    expect(parseCaptionText('random')).toEqual([])
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

  it('超出 0.5s 尾部宽限且下一句未开始返回 -1（与桌面端一致）', () => {
    const sparse = [
      { start: 0, dur: 1, text: 'x' },
      { start: 10, dur: 1, text: 'y' }
    ]
    // x 在 1.0 结束，1.5 仍在宽限内；3s 已超出宽限
    expect(findActiveCueIndex(sparse, 1.5)).toBe(0)
    expect(findActiveCueIndex(sparse, 3)).toBe(-1)
  })

  it('开头之前返回 -1', () => {
    expect(findActiveCueIndex([{ start: 5, dur: 1, text: 'x' }], 1)).toBe(-1)
  })
})
