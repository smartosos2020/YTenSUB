import { describe, expect, it } from 'vitest'
import { searchResources } from '../src/main/resource-search'
import { containedFile, validateMagnet } from '../src/main/resource-downloads'
import path from 'node:path'

describe('资源搜索与下载输入', () => {
  it('仅返回匹配的视频，排除其他剧集、非视频和占位结果，按做种人数排序并去重', async () => {
    const hash = (id: number): string => id.toString(16).padStart(40, '0')
    const row = (id: number, name: string, category = '205', seeders = '10') => ({ id: String(id), name, info_hash: hash(id), category, seeders, size: '1024', added: '1700000000' })
    const results = await searchResources('Young Sheldon S01E02', async (url) => {
      expect(new URL(url).searchParams.get('q')).toBe('Young Sheldon S01E02')
      return new Response(JSON.stringify([
        row(1, 'Young.Sheldon.S01E02.720p'), row(2, 'Young.Sheldon.S01E01.720p'),
        row(3, 'Suits.S01E02.720p'), row(4, 'Young.Sheldon.S01E02.exe', '301'),
        row(5, 'Young.Sheldon.S01E02.1080p', '208', '30'), row(5, 'Young.Sheldon.S01E02.1080p', '208', '30'),
        row(0, 'No results returned', '0')
      ]))
    })
    expect(results.map((item) => item.id)).toEqual([hash(5), hash(1)])
    expect(new URL(results[0].magnet).searchParams.get('xt')).toBe(`urn:btih:${hash(5)}`)
    expect(new URL(results[0].magnet).searchParams.getAll('tr')).toEqual(expect.arrayContaining([
      'udp://tracker.opentrackr.org:1337/announce', 'http://tracker.dler.org:6969/announce'
    ]))
  })

  it('源站错误明确提示，不将错误页面当作空结果', async () => {
    await expect(searchResources('Show', async () => new Response('<html>error</html>'))).rejects.toThrow('暂时不可用')
    await expect(searchResources('Show', async () => new Response('', { status: 503 }))).rejects.toThrow('503')
  })

  it('磁力链接不能变为本地文件或任意协议请求', () => {
    const magnet = `magnet:?xt=urn:btih:${'a'.repeat(40)}`
    expect(validateMagnet(magnet)).toBe(magnet)
    expect(new URL(validateMagnet(`magnet:?xt=urn:btih:${'V'.repeat(32)}`)).searchParams.get('xt')).toBe(`urn:btih:${'ad6b5'.repeat(8)}`)
    for (const value of ['file:///C:/secret', 'https://example.com', 'magnet:?xt=bad', `${magnet}&tr=file:///C:/secret`]) {
      expect(() => validateMagnet(value)).toThrow()
    }
  })

  it('下载文件不能通过绝对路径、目录穿越或 Windows ADS 越出目录', () => {
    const root = path.resolve('download-test')
    expect(containedFile(root, ['Show', 'S01E02.mkv'])).toBe(path.join(root, 'Show', 'S01E02.mkv'))
    for (const parts of [['..', 'secret'], ['C:', 'secret'], ['x/y.mkv'], ['x\\y.mkv'], ['video.mkv:stream'], ['\0']]) {
      expect(() => containedFile(root, parts)).toThrow()
    }
  })
})
