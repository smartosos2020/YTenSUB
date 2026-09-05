import { describe, expect, it } from 'vitest'
import { googleTranslateFree, translateBatch, translateText, TranslateDeps } from '../src/main/translate'

function deps(overrides: Partial<TranslateDeps>): TranslateDeps {
  return {
    localLookup: () => null,
    googleTranslate: async () => null,
    llmTranslate: async () => null,
    enabled: ['local', 'google', 'llm'],
    ...overrides
  }
}

describe('translateText 回退链', () => {
  it('本地命中时不再走网络', async () => {
    let googleCalled = false
    const r = await translateText(
      'hello',
      deps({
        localLookup: () => ({ translation: '你好', phonetic: 'həˈləʊ' }),
        googleTranslate: async () => {
          googleCalled = true
          return 'x'
        }
      })
    )
    expect(r).toEqual({ text: 'hello', translation: '你好', phonetic: 'həˈləʊ', source: 'local' })
    expect(googleCalled).toBe(false)
  })

  it('本地未命中回退到 Google', async () => {
    const r = await translateText('hello world', deps({ googleTranslate: async () => '你好世界' }))
    expect(r?.source).toBe('google')
    expect(r?.translation).toBe('你好世界')
  })

  it('Google 失败回退到 LLM', async () => {
    const r = await translateText(
      'hello',
      deps({
        googleTranslate: async () => {
          throw new Error('network')
        },
        llmTranslate: async () => '你好'
      })
    )
    expect(r?.source).toBe('llm')
  })

  it('只启用 local 时不访问网络', async () => {
    const r = await translateText(
      'unknownword',
      deps({
        enabled: ['local'],
        googleTranslate: async () => '不应被调用'
      })
    )
    expect(r).toBeNull()
  })

  it('全部失败返回 null', async () => {
    const r = await translateText('x', deps({}))
    expect(r).toBeNull()
  })

  it('空白输入直接返回 null', async () => {
    expect(await translateText('   ', deps({}))).toBeNull()
  })
})

describe('googleTranslateFree 响应解析', () => {
  it('拼接分段译文', async () => {
    const fetchFn = async () =>
      new Response(JSON.stringify([[['你好', 'hello'], ['世界', ' world']]]), { status: 200 })
    expect(await googleTranslateFree('hello world', fetchFn)).toBe('你好世界')
  })

  it('HTTP 错误返回 null', async () => {
    const fetchFn = async () => new Response('err', { status: 500 })
    expect(await googleTranslateFree('hi', fetchFn)).toBeNull()
  })
})

describe('translateBatch 整句批量翻译', () => {
  it('结果与输入等长且顺序一致', async () => {
    const r = await translateBatch(['a', 'b', 'c'], async (t) => t + '!', 2)
    expect(r).toEqual(['a!', 'b!', 'c!'])
  })

  it('单条失败不影响其它，失败位置为 null', async () => {
    const r = await translateBatch(
      ['a', 'x', 'c'],
      async (t) => {
        if (t === 'x') throw new Error('boom')
        return t
      },
      2
    )
    expect(r).toEqual(['a', null, 'c'])
  })

  it('空白文本不调用翻译，对应位置为 null', async () => {
    let calls = 0
    const r = await translateBatch(
      ['  ', 'a'],
      async (t) => {
        calls++
        return t
      },
      2
    )
    expect(calls).toBe(1)
    expect(r).toEqual([null, 'a'])
  })

  it('同时在飞的翻译不超过并发上限', async () => {
    let cur = 0
    let max = 0
    const input = Array.from({ length: 10 }, (_, i) => String(i))
    const r = await translateBatch(
      input,
      async (t) => {
        cur++
        max = Math.max(max, cur)
        await new Promise((resolve) => setTimeout(resolve, 5))
        cur--
        return t
      },
      3
    )
    expect(max).toBeLessThanOrEqual(3)
    expect(r).toEqual(input)
  })
})

describe('llmContextualTranslate 语境释义', () => {
  it('prompt 同时包含句子与单词', async () => {
    let captured = ''
    const fetchFn = (async (_u: string, init?: RequestInit) => {
      captured = String(JSON.parse(String(init?.body)).messages[1].content)
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '（金融机构的）债券' } }] }),
        { status: 200 }
      )
    }) as (url: string, init?: RequestInit) => Promise<Response>
    const { llmContextualTranslate } = await import('../src/main/translate')
    const r = await llmContextualTranslate(
      'bond',
      'The Treasury bond yields rose sharply.',
      { baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' },
      fetchFn
    )
    expect(r).toBe('（金融机构的）债券')
    expect(captured).toContain('The Treasury bond yields rose sharply.')
    expect(captured).toContain('bond')
  })
})

describe('llmTagFavorite 自动打标签', () => {
  const cfg = { baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' }
  const presets = ['生活', '科技', '商业']
  type FetchLike = (url: string, init?: RequestInit) => Promise<Response>
  const fetchWith = (content: string): FetchLike => {
    return async () =>
      new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })
  }

  it('正常 JSON 数组 → 标签去重截断', async () => {
    const { llmTagFavorite } = await import('../src/main/translate')
    const r = await llmTagFavorite('t', 'c', 's', presets, cfg, fetchWith('["科技","科技","生活","商业","教育"]'))
    expect(r).toEqual(['科技', '生活', '商业']) // 去重 + 最多 3 个
  })

  it('带解释文字的输出 → 只取数组部分；坏输出 → 空', async () => {
    const { llmTagFavorite } = await import('../src/main/translate')
    const r = await llmTagFavorite('t', 'c', 's', presets, cfg, fetchWith('我认为是 ["生活"] 这样'))
    expect(r).toEqual(['生活'])
    expect(await llmTagFavorite('t', 'c', 's', presets, cfg, fetchWith('没有数组'))).toEqual([])
  })
})
