import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseExternalSubtitle } from '../src/shared/captions'
import {
  computeHashFromParts,
  downloadOpenSubtitle,
  fetchWithDeadline,
  findSidecarSubtitle,
  parseMediaByteRange,
  parseEpisodeInfo,
  saveDownloadedSubtitle,
  searchOpenSubtitles,
  readLocalVideoFolder,
  readLocalVideo,
  resolvePlaylistVideo
} from '../src/main/local-media'

describe('parseEpisodeInfo', () => {
  it('从美剧常见 SxxEyy 文件名提取剧名和季集', () => {
    expect(parseEpisodeInfo('The.Bear.S03E05.1080p.WEB-DL.mkv')).toEqual({
      query: 'The Bear',
      season: 3,
      episode: 5
    })
  })

  it('兼容 1x02 命名', () => {
    expect(parseEpisodeInfo('Friends 1x02 The One with the Sonogram.avi')).toEqual({
      query: 'Friends',
      season: 1,
      episode: 2
    })
  })
})

describe('parseExternalSubtitle', () => {
  it('解析 SRT 并清理格式标签', () => {
    const cues = parseExternalSubtitle(
      '1\n00:00:01,250 --> 00:00:03,500\n<i>Hello</i> world!\n\n'
    )
    expect(cues).toEqual([{ start: 1.25, dur: 2.25, text: 'Hello world!' }])
  })

  it('解析 WebVTT', () => {
    const cues = parseExternalSubtitle(
      'WEBVTT\n\n00:02.000 --> 00:04.200 align:middle\nHow are you?\n'
    )
    expect(cues).toEqual([{ start: 2, dur: 2.2, text: 'How are you?' }])
  })

  it('解析 ASS Dialogue 并移除样式控制符', () => {
    const ass = `[Script Info]\nTitle: Sample\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:05.00,0:00:07.50,Default,,0,0,0,,{\\i1}Wait{\\i0}\\Nfor me.`
    expect(parseExternalSubtitle(ass)).toEqual([
      { start: 5, dur: 2.5, text: 'Wait for me.' }
    ])
  })
})

describe('computeHashFromParts', () => {
  it('按 64 位小端整数累加文件大小与头尾内容', () => {
    const head = Buffer.alloc(16)
    const tail = Buffer.alloc(8)
    head.writeBigUInt64LE(1n, 0)
    head.writeBigUInt64LE(2n, 8)
    tail.writeBigUInt64LE(3n, 0)
    expect(computeHashFromParts(1000n, head, tail)).toBe('00000000000003ee')
  })
})

describe('parseMediaByteRange', () => {
  it('解析播放器常见的开放区间并限制到文件结尾', () => {
    expect(parseMediaByteRange('bytes=100-', 1000)).toEqual({ start: 100, end: 999 })
    expect(parseMediaByteRange('bytes=100-2000', 1000)).toEqual({ start: 100, end: 999 })
  })

  it('支持后缀区间并拒绝越界或多区间请求', () => {
    expect(parseMediaByteRange('bytes=-200', 1000)).toEqual({ start: 800, end: 999 })
    expect(parseMediaByteRange('bytes=1000-', 1000)).toBeNull()
    expect(parseMediaByteRange('bytes=0-10,20-30', 1000)).toBeNull()
  })
})

describe('findSidecarSubtitle', () => {
  it('会在视频目录下的字幕子文件夹中查找同名字幕', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ytensub-sidecar-'))
    try {
      const videoPath = path.join(root, 'Show.S01E01.mkv')
      const subtitleDir = path.join(root, 'Subs', 'English')
      fs.mkdirSync(subtitleDir, { recursive: true })
      fs.writeFileSync(videoPath, 'video')
      fs.writeFileSync(
        path.join(subtitleDir, 'Show.S01E01.srt'),
        '1\n00:00:01,000 --> 00:00:02,000\nHello\n'
      )

      expect(findSidecarSubtitle(videoPath)).toMatchObject({
        fileName: 'Show.S01E01.srt',
        text: expect.stringContaining('Hello')
      })
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('同目录字幕优先于子文件夹中的字幕', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ytensub-sidecar-'))
    try {
      const videoPath = path.join(root, 'Show.S01E01.mkv')
      fs.mkdirSync(path.join(root, 'Subs'))
      fs.writeFileSync(videoPath, 'video')
      fs.writeFileSync(path.join(root, 'Show.S01E01.srt'), 'direct subtitle')
      fs.writeFileSync(path.join(root, 'Subs', 'Show.S01E01.srt'), 'nested subtitle')

      expect(findSidecarSubtitle(videoPath)?.text).toBe('direct subtitle')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('保存在线字幕并重新加载', () => {
  let root: string
  let videoPath: string
  const text = '1\n00:00:01,000 --> 00:00:02,000\nHello\n'

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ytensub-download-'))
    videoPath = path.join(root, 'Show.S01E01.mkv')
    fs.writeFileSync(videoPath, 'video')
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('创建 dSub 并按视频名称保存，重新打开时使用选中的在线字幕', async () => {
    fs.writeFileSync(path.join(root, 'Show.S01E01.srt'), 'older local subtitle')
    const savedPath = await saveDownloadedSubtitle(videoPath, {
      fileName: '../../different-release.srt', text
    })

    expect(savedPath).toBe(path.join(root, 'dSub', 'Show.S01E01.en.srt'))
    expect(fs.readFileSync(savedPath, 'utf8')).toBe(text)
    expect(findSidecarSubtitle(videoPath)).toEqual({ fileName: 'Show.S01E01.en.srt', text })
    expect(fs.readFileSync(videoPath, 'utf8')).toBe('video')
  })

  it('再次选择同格式字幕时替换已保存的版本', async () => {
    const savedPath = await saveDownloadedSubtitle(videoPath, { fileName: 'first.srt', text })
    const updated = text.replace('Hello', 'Selected another release')
    await saveDownloadedSubtitle(videoPath, { fileName: 'second.srt', text: updated })

    expect(fs.readFileSync(savedPath, 'utf8')).toBe(updated)
    expect(fs.readdirSync(path.dirname(savedPath))).toEqual(['Show.S01E01.en.srt'])
    expect(findSidecarSubtitle(videoPath)?.text).toBe(updated)
  })

  it('保留字幕格式，并在不同格式中自动加载最新选择的版本', async () => {
    const firstPath = await saveDownloadedSubtitle(videoPath, { fileName: 'first.srt', text })
    fs.utimesSync(firstPath, new Date('2020-01-01'), new Date('2020-01-01'))
    const vtt = 'WEBVTT\n\n00:01.000 --> 00:02.000\nNew selection\n'
    const savedPath = await saveDownloadedSubtitle(videoPath, { fileName: 'second.VTT', text: vtt })

    expect(path.extname(savedPath)).toBe('.vtt')
    expect(findSidecarSubtitle(videoPath)).toEqual({ fileName: 'Show.S01E01.en.vtt', text: vtt })
  })

  it('无效字幕不会覆盖已保存的字幕', async () => {
    const savedPath = await saveDownloadedSubtitle(videoPath, { fileName: 'valid.srt', text })
    await expect(saveDownloadedSubtitle(videoPath, {
      fileName: 'invalid.srt', text: '<html>Download error</html>'
    })).rejects.toThrow('无法解析下载的字幕')

    expect(fs.readFileSync(savedPath, 'utf8')).toBe(text)
    expect(fs.readdirSync(path.dirname(savedPath))).toEqual(['Show.S01E01.en.srt'])
  })

  it('无法创建目录时报告保存错误', async () => {
    fs.writeFileSync(path.join(root, 'dSub'), 'existing file')
    await expect(saveDownloadedSubtitle(videoPath, { fileName: 'valid.srt', text })).rejects.toThrow()
    expect(fs.readFileSync(path.join(root, 'dSub'), 'utf8')).toBe('existing file')
  })
})

describe('本地播放列表', () => {
  let root: string

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ytensub-playlist-')))
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('只列出视频文件，兼容大写扩展名，并按剧集自然顺序排序', async () => {
    for (const name of ['Show10.mkv', 'Show2.MP4', 'Show1.avi', 'readme.txt', 'Show1.srt']) {
      fs.writeFileSync(path.join(root, name), '')
    }
    fs.mkdirSync(path.join(root, 'folder.mp4'))
    const folder = await readLocalVideoFolder(root)

    expect(folder.videos.map((video) => video.name)).toEqual(['Show1.avi', 'Show2.MP4', 'Show10.mkv'])
    expect(folder.videos[0].path).toBe(path.join(root, 'Show1.avi'))
    expect(folder.error).toBeUndefined()
  })

  it('设备断开或文件夹不存在时保留文件夹并显示读取错误', async () => {
    const folderPath = path.join(root, 'missing')
    expect(await readLocalVideoFolder(folderPath)).toMatchObject({
      path: folderPath, name: 'missing', videos: [], error: expect.any(String)
    })
  })

  it('点击视频时读取同一套视频信息和本地字幕，并限制在已添加的文件夹中', async () => {
    const videoPath = path.join(root, 'Show.S01E02.mkv')
    fs.writeFileSync(videoPath, 'video')
    fs.writeFileSync(path.join(root, 'Show.S01E02.srt'), '1\n00:00:01,000 --> 00:00:02,000\nHello\n')
    expect(await resolvePlaylistVideo(videoPath, [root])).toBe(videoPath)
    expect(await readLocalVideo(videoPath)).toMatchObject({
      path: videoPath, name: 'Show.S01E02.mkv', season: 1, episode: 2,
      size: 5, hash: null, sidecarSubtitle: { text: expect.stringContaining('Hello') }
    })
    await expect(resolvePlaylistVideo(videoPath, [])).rejects.toThrow('添加到播放列表')
    await expect(resolvePlaylistVideo(path.join(root, 'Show.S01E02.srt'), [root])).rejects.toThrow('添加到播放列表')
  })
})

describe('在线字幕推荐', () => {
  it('精确匹配优先，推荐理由来自实际匹配信息', async () => {
    const results = await searchOpenSubtitles({
      apiKey: 'test-key',
      hash: null,
      query: 'Show',
      fileName: 'Show.S01E01.BluRay-GROUP.mkv',
      season: 1,
      episode: 1,
      userAgent: 'test-agent',
      fetchFn: async () => new Response(JSON.stringify({ data: [
        { id: 'popular', attributes: {
          download_count: 100000,
          files: [{ file_id: 1, file_name: 'different.srt' }]
        } },
        { id: 'release', attributes: {
          release: 'Show.S01E01.BluRay-GROUP',
          feature_details: { season_number: 1, episode_number: 1 },
          files: [{ file_id: 2, file_name: 'release.srt' }]
        } },
        { id: 'exact', attributes: {
          moviehash_match: true,
          files: [{ file_id: 3, file_name: 'exact.srt' }]
        } }
      ] }), { headers: { 'Content-Type': 'application/json' } })
    })

    expect(results.map((candidate) => candidate.fileId)).toEqual([3, 2, 1])
    expect(results[0].matchReasons).toEqual(['文件 Hash 精确匹配'])
    expect(results[1].matchReasons).toContain('季数一致')
    expect(results[1].matchReasons).toContain('集数一致')
    expect(results[1].matchReasons.join(' ')).toContain('bluray')
    expect(results[2].matchReasons).toEqual(['参考下载量'])
  })
})

describe('downloadOpenSubtitle', () => {
  it('即使底层 fetch 忽略 AbortSignal，也会在截止时间后返回错误', async () => {
    const neverFetch = (): Promise<Response> => new Promise(() => {})
    await expect(fetchWithDeadline(
      neverFetch,
      'https://example.test/subtitle.srt',
      {},
      5,
      '字幕文件下载超时'
    )).rejects.toThrow('字幕文件下载超时')
  })

  it('只在 API 请求携带 API User-Agent，CDN 下载使用浏览器默认标识', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchFn = async (url: string | URL, init?: RequestInit): Promise<Response> => {
      calls.push({ url: String(url), init })
      if (calls.length === 1) {
        return new Response(JSON.stringify({
          link: 'https://www.opensubtitles.com/download/example/subfile/test.srt',
          file_name: 'test.srt',
          remaining: 4
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('1\n00:00:01,000 --> 00:00:02,000\nHello\n', { status: 200 })
    }

    const result = await downloadOpenSubtitle({
      apiKey: 'test-key',
      fileId: 123,
      userAgent: 'YTenSUB v0.1.12',
      fetchFn
    })

    expect(result).toMatchObject({ fileName: 'test.srt', remaining: 4 })
    expect(calls[0].init?.headers).toMatchObject({ 'User-Agent': 'YTenSUB v0.1.12' })
    expect(calls[1].init?.headers).toBeUndefined()
    expect(calls[1].init?.signal).toBeInstanceOf(AbortSignal)
  })
})
