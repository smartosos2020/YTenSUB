import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VocabVisuals, isLikelyConcreteNoun } from '../src/main/vocab-visuals'

const dirs: string[] = []

function cache(fetchFn: typeof fetch, maxBytes?: number): VocabVisuals {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytensub-visual-test-'))
  dirs.push(dir)
  return new VocabVisuals(
    path.join(dir, 'manifest.json'),
    path.join(dir, 'images'),
    fetchFn,
    maxBytes
  )
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('VocabVisuals', () => {
  it('无 LLM 时跳过典型抽象名词，保留具体名词', () => {
    expect(isLikelyConcreteNoun('apple', 'n. 苹果')).toBe(true)
    expect(isLikelyConcreteNoun('accountability', 'n. 责任；问责')).toBe(false)
    expect(isLikelyConcreteNoun('happiness', 'n. 幸福')).toBe(false)
  })

  it('高频概念优先缓存 Noto SVG，第二次命中不再联网', async () => {
    const fetchFn = vi.fn(async () =>
      new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', {
        headers: { 'content-type': 'image/svg+xml' }
      })
    )
    const visuals = cache(fetchFn)
    const queryFactory = vi.fn(async () => 'should not run')
    const request = { text: 'apple', translation: 'n. 苹果', sentence: 'I ate an apple.' }

    const first = await visuals.get(request, queryFactory)
    const second = await visuals.get(request, queryFactory)

    expect(first?.source).toBe('noto')
    expect(first?.imageDataUrl).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(second?.id).toBe(first?.id)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(queryFactory).not.toHaveBeenCalled()
    expect(visuals.sizeBytes).toBeGreaterThan(0)
  })

  it('未命中 Emoji 时查询 Openverse，并过滤不安全候选', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const value = String(url)
      if (value.startsWith('https://api.openverse.org/')) {
        return Response.json({
          results: [
            { id: 'bad', title: 'sexual quasar', thumbnail: 'https://img.test/bad.jpg', license: 'by' },
            {
              id: 'good',
              title: 'Quasar illustration',
              thumbnail: 'https://img.test/good.jpg',
              creator: 'Example Artist',
              license: 'cc0',
              foreign_landing_url: 'https://example.test/work'
            }
          ]
        })
      }
      if (value === 'https://img.test/good.jpg') {
        return new Response(new Uint8Array([1, 2, 3, 4]), {
          headers: { 'content-type': 'image/jpeg' }
        })
      }
      throw new Error(`unexpected URL: ${value}`)
    })
    const visuals = cache(fetchFn)
    const result = await visuals.get(
      { text: 'quasar', translation: 'n. 类星体', sentence: 'A quasar is extremely bright.' },
      async () => 'quasar'
    )

    expect(result).toMatchObject({ source: 'openverse', id: 'good', creator: 'Example Artist' })
    expect(result?.imageDataUrl).toBe('data:image/jpeg;base64,AQIDBA==')
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('Openverse 没有结果时回退 Wikimedia Commons', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const value = String(url)
      if (value.startsWith('https://api.openverse.org/')) return Response.json({ results: [] })
      if (value.startsWith('https://commons.wikimedia.org/')) {
        return Response.json({
          query: {
            pages: {
              '42': {
                pageid: 42,
                title: 'File:Quasar.jpg',
                imageinfo: [{
                  thumburl: 'https://upload.wikimedia.test/quasar.jpg',
                  descriptionurl: 'https://commons.wikimedia.org/wiki/File:Quasar.jpg',
                  extmetadata: {
                    LicenseShortName: { value: 'CC BY 4.0' },
                    Artist: { value: 'Example Author' }
                  }
                }]
              }
            }
          }
        })
      }
      if (value === 'https://upload.wikimedia.test/quasar.jpg') {
        return new Response(new Uint8Array([5, 6, 7]), { headers: { 'content-type': 'image/jpeg' } })
      }
      throw new Error(`unexpected URL: ${value}`)
    })
    const visuals = cache(fetchFn)
    const result = await visuals.get(
      { text: 'quasar', translation: 'n. 类星体', sentence: 'A distant quasar.' },
      async () => 'quasar'
    )

    expect(result).toMatchObject({ source: 'wikimedia', id: '42', license: 'CC BY 4.0' })
    expect(fetchFn).toHaveBeenCalledTimes(3)
  })

  it('换图会拒绝当前候选并选择下一张', async () => {
    const search = {
      results: [
        { id: 'one', title: 'Nebula one', thumbnail: 'https://img.test/one.jpg', license: 'cc0' },
        { id: 'two', title: 'Nebula two', thumbnail: 'https://img.test/two.jpg', license: 'cc0' }
      ]
    }
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const value = String(url)
      if (value.startsWith('https://api.openverse.org/')) return Response.json(search)
      return new Response(new Uint8Array([9, 8, 7]), { headers: { 'content-type': 'image/jpeg' } })
    })
    const visuals = cache(fetchFn)
    const request = { text: 'nebula', translation: 'n. 星云', sentence: 'The nebula glowed.' }

    const first = await visuals.get(request, async () => 'nebula')
    const next = await visuals.get(request, async () => 'nebula', true)

    expect(first?.id).toBe('one')
    expect(next?.id).toBe('two')
  })

  it('按实际图片字节执行 LRU，缓存不会超过设定上限', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const value = String(url)
      if (value.startsWith('https://api.openverse.org/')) {
        const query = new URL(value).searchParams.get('q')
        return Response.json({
          results: [{ id: query, title: query, thumbnail: `https://img.test/${query}.jpg`, license: 'cc0' }]
        })
      }
      return new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'content-type': 'image/jpeg' } })
    })
    const visuals = cache(fetchFn, 5)

    await visuals.get(
      { text: 'quasar', translation: 'n. 类星体', sentence: 'A quasar.' },
      async () => 'quasar'
    )
    await visuals.get(
      { text: 'nebula', translation: 'n. 星云', sentence: 'A nebula.' },
      async () => 'nebula'
    )

    expect(visuals.sizeBytes).toBe(4)
  })
})
