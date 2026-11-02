import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { extractScript } from '../src/lib/extract'

describe('WebView caption response correlation', () => {
  it('includes the request ID and target video on successful extraction', async () => {
    const messages: { requestId: number; payload: { videoId: string } }[] = []
    await runInNewContext(extractScript(17), {
      URLSearchParams,
      location: { search: '?v=abcdefghijk', pathname: '/watch' },
      fetch: async () => ({ json: async () => ({ videoDetails: { videoId: 'abcdefghijk' } }) }),
      window: { ReactNativeWebView: { postMessage: (raw: string) => messages.push(JSON.parse(raw)) } }
    })
    expect(messages[0].requestId).toBe(17)
    expect(messages[0].payload.videoId).toBe('abcdefghijk')
  })

  it('preserves the request ID on failed extraction so an old failure can be ignored', async () => {
    const messages: { requestId: number; payload: { ok: boolean } }[] = []
    await runInNewContext(extractScript(18), {
      URLSearchParams,
      location: { search: '?v=abcdefghijk', pathname: '/watch' },
      fetch: async () => { throw new Error('temporary network failure') },
      window: { ReactNativeWebView: { postMessage: (raw: string) => messages.push(JSON.parse(raw)) } }
    })
    expect(messages[0].requestId).toBe(18)
    expect(messages[0].payload.ok).toBe(false)
  })
})
