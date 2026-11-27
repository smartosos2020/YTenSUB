import { describe, expect, it, vi } from 'vitest'
import { fetchEnglishCues } from '../src/main/shadowing'

const URL = 'https://www.youtube.com/api/timedtext?v=example&fmt=srv3&signature=keep'
const player = (tracks = [{ languageCode: 'en', baseUrl: URL }]) => Response.json({ playabilityStatus: { status: 'OK' }, videoDetails: { title: 'Example' }, captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } } })
const subtitle = () => Response.json({ events: [{ tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: 'Hello world.' }] }] })

describe('英文字幕抓取的错误分类', () => {
  it('优先人工英文轨，保留签名 URL 与 fmt，不改写参数', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(player([
      { languageCode: 'en', baseUrl: URL + '&kind=asr', kind: 'asr' }, { languageCode: 'en-US', baseUrl: URL }
    ] as { languageCode: string; baseUrl: string }[])).mockResolvedValueOnce(subtitle())
    expect(await fetchEnglishCues('example', fetchFn)).toMatchObject({ title: 'Example', cues: [{ text: 'Hello world.' }] })
    expect(fetchFn.mock.calls[1][0]).toBe(URL)
    expect(fetchFn.mock.calls.every(([, init]) => init.signal instanceof AbortSignal)).toBe(true)
  })

  it.each([429, 403, 500])('播放器 HTTP %i 不会被误认为无字幕', async status => {
    expect(await fetchEnglishCues('example', async () => new Response('', { status }))).toMatchObject({ error: status === 429 ? 'rate-limited' : 'http-error', stage: 'player', status })
  })

  it('连接超时保留错误码，不泄露带凭证的原始异常', async () => {
    const error = new Error('fetch https://secret.example?token=secret', { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } })
    const result = await fetchEnglishCues('example', async () => { throw error })
    expect(result).toEqual({ error: 'network-error', stage: 'player', reason: 'UND_ERR_CONNECT_TIMEOUT' })
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  it('登录/机器人验证、无英文轨、失效视频、空字幕分别报告', async () => {
    expect(await fetchEnglishCues('example', async () => Response.json({ playabilityStatus: { status: 'LOGIN_REQUIRED' } }))).toMatchObject({ error: 'player-error', reason: 'LOGIN_REQUIRED' })
    expect(await fetchEnglishCues('example', async () => player([]))).toMatchObject({ error: 'no-captions' })
    expect(await fetchEnglishCues('example', async () => Response.json({ playabilityStatus: { status: 'UNPLAYABLE' } }))).toMatchObject({ error: 'video-unavailable' })
    const fetchFn = vi.fn().mockResolvedValueOnce(player()).mockResolvedValueOnce(new Response(''))
    expect(await fetchEnglishCues('example', fetchFn)).toMatchObject({ error: 'empty-captions', stage: 'captions' })
  })

  it('无效播放器响应、字幕接口限流与断网均不归为无字幕', async () => {
    expect(await fetchEnglishCues('example', async () => new Response('<html>error</html>'))).toMatchObject({ error: 'invalid-response', stage: 'player' })
    expect(await fetchEnglishCues('example', async () => Response.json({}))).toMatchObject({ error: 'invalid-response' })
    expect(await fetchEnglishCues('example', async () => Response.json({ playabilityStatus: { status: 'ERROR' } }))).toMatchObject({ error: 'player-error' })
    const limited = vi.fn().mockResolvedValueOnce(player()).mockResolvedValueOnce(new Response('', { status: 429 }))
    expect(await fetchEnglishCues('example', limited)).toMatchObject({ error: 'rate-limited', stage: 'captions', status: 429 })
    const offline = vi.fn().mockResolvedValueOnce(player()).mockRejectedValueOnce(new TypeError('fetch failed'))
    expect(await fetchEnglishCues('example', offline)).toMatchObject({ error: 'network-error', stage: 'captions' })
  })
})
