import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseExternalSubtitle } from '../src/shared/captions'
import {
  computeHashFromParts,
  downloadOpenSubtitle,
  fetchWithDeadline,
  findSidecarSubtitle,
  parseMediaByteRange,
  parseEpisodeInfo
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
