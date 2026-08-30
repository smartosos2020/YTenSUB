import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CaptionsCache, CAPTIONS_CACHE_MAX } from '../src/main/captions-cache'
import { Cue } from '../src/shared/captions'

const cues = (n: number): Cue[] =>
  Array.from({ length: n }, (_, i) => ({ start: i, dur: 1, text: `line ${i}` }))

let dir: string
let file: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytensub-caps-'))
  file = path.join(dir, 'captions-cache.json')
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('CaptionsCache', () => {
  it('put 后 get 命中，空英文字幕不缓存', () => {
    const c = new CaptionsCache(file)
    c.put('v1', { title: 't', channel: 'ch', en: cues(3), zh: null })
    expect(c.get('v1')?.en).toHaveLength(3)
    c.put('v2', { title: 't', channel: 'ch', en: [], zh: null })
    expect(c.get('v2')).toBeNull()
  })

  it('命中刷新最近观看锚点（touchedAt 前进）', () => {
    const c = new CaptionsCache(file)
    c.put('v1', { title: 't', channel: 'ch', en: cues(1), zh: null })
    const before = c.get('v1')!.touchedAt
    const after = c.get('v1')!.touchedAt
    expect(after).toBeGreaterThanOrEqual(before)
  })

  it('LRU：超过上限淘汰最久未使用的，刚被观看的不会被误清', () => {
    const c = new CaptionsCache(file)
    // 塞满上限
    for (let i = 0; i < CAPTIONS_CACHE_MAX; i++) {
      c.put(`v${i}`, { title: 't', channel: 'ch', en: cues(1), zh: null })
    }
    // 观看最早的 v0（刷新锚点），再放入一个新视频触发淘汰
    expect(c.get('v0')).not.toBeNull()
    c.put('new-video', { title: 't', channel: 'ch', en: cues(1), zh: null })
    expect(c.size).toBe(CAPTIONS_CACHE_MAX)
    expect(c.get('v0')).not.toBeNull() // 刚看过的保住
    expect(c.get('v1')).toBeNull() // 最久没用的被淘汰
  })

  it('flush 后可重新加载，损坏时回退 .bak', () => {
    const c = new CaptionsCache(file)
    c.put('v1', { title: 't', channel: 'ch', en: cues(2), zh: cues(2) })
    c.flush()
    const c2 = new CaptionsCache(file)
    expect(c2.get('v1')?.zh).toHaveLength(2)
    // .bak 在第二次覆盖写入时才生成（备份的是上一份完好数据）
    c2.flush()
    // 主文件损坏 → 回退 .bak
    fs.writeFileSync(file, 'not-json', 'utf8')
    const c3 = new CaptionsCache(file)
    expect(c3.get('v1')).not.toBeNull()
  })

  it('clear 清空且落盘', () => {
    const c = new CaptionsCache(file)
    c.put('v1', { title: 't', channel: 'ch', en: cues(1), zh: null })
    c.clear()
    c.flush()
    expect(c.size).toBe(0)
    expect(new CaptionsCache(file).size).toBe(0)
  })
})
