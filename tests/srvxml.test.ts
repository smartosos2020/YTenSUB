import { describe, expect, it } from 'vitest'
import { parseCaptionText, parseSrvXml } from '../src/shared/captions'

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
