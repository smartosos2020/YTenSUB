import { describe, expect, it } from 'vitest'
import { Dict } from '../src/main/dict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function makeDict(data: Record<string, unknown>): Dict {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dict-')), 'dict.json')
  fs.writeFileSync(file, JSON.stringify(data), 'utf8')
  return new Dict(file)
}

describe('Dict', () => {
  it('精确命中（大小写不敏感）', () => {
    const dict = makeDict({ hello: { p: 'həˈləʊ', t: '你好' } })
    expect(dict.lookup('Hello')).toEqual({ p: 'həˈləʊ', t: '你好' })
  })

  it('词形还原：复数 / 过去式 / 进行时', () => {
    const dict = makeDict({
      apple: { t: '苹果' },
      study: { t: '学习' },
      stop: { t: '停止' },
      make: { t: '制作' }
    })
    expect(dict.lookup('apples')?.t).toBe('苹果')
    expect(dict.lookup('studies')?.t).toBe('学习')
    expect(dict.lookup('studied')?.t).toBe('学习')
    expect(dict.lookup('studying')?.t).toBe('学习')
    expect(dict.lookup('making')?.t).toBe('制作')
  })

  it('短语不查本地词典', () => {
    const dict = makeDict({ hello: { t: '你好' } })
    expect(dict.lookup('hello world')).toBeNull()
  })

  it('未收录词返回 null', () => {
    const dict = makeDict({})
    expect(dict.lookup('unobtainium')).toBeNull()
  })

  it('词典文件缺失时返回 null 而不是崩溃', () => {
    const dict = new Dict('/nonexistent/dict.json')
    expect(dict.lookup('hello')).toBeNull()
  })
})
