import { afterEach, describe, expect, it, vi } from 'vitest'
import { translate } from '../src/lib/translate'

describe('mobile translate (Hermes compatible timeout)', () => {
  const originalFetch = globalThis.fetch
  const originalTimeout = AbortSignal.timeout

  afterEach(() => {
    globalThis.fetch = originalFetch
    Object.defineProperty(AbortSignal, 'timeout', {
      value: originalTimeout,
      configurable: true,
      writable: true
    })
    vi.useRealTimers()
  })

  it('works for phrases even when AbortSignal.timeout is unavailable (Hermes)', async () => {
    Object.defineProperty(AbortSignal, 'timeout', {
      value: undefined,
      configurable: true,
      writable: true
    })
    let capturedSignal: AbortSignal | undefined
    globalThis.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined
      return new Response(JSON.stringify([[['你好', 'hello'], ['世界', ' world']]]), { status: 200 })
    }) as typeof fetch

    const result = await translate('hello world')
    expect(result).toEqual({ translation: '你好世界', source: 'google' })
    expect(capturedSignal).toBeInstanceOf(AbortSignal)
    expect(capturedSignal?.aborted).toBe(false)
  })

  it('returns null on non-2xx HTTP status', async () => {
    globalThis.fetch = vi.fn(async () => new Response('error', { status: 503 })) as typeof fetch
    expect(await translate('hello world')).toBeNull()
  })

  it('aborts hung request after 10s timeout and returns null', async () => {
    vi.useFakeTimers()
    let aborted = false
    globalThis.fetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })
    ) as typeof fetch

    const promise = translate('hello world')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await promise).toBeNull()
    expect(aborted).toBe(true)
  })

  it('aborts when response headers arrive immediately but body hangs', async () => {
    vi.useFakeTimers()
    let aborted = false
    globalThis.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      init?.signal?.addEventListener('abort', () => {
        aborted = true
      })
      return {
        ok: true,
        status: 200,
        json: () => new Promise(() => {})
      } as unknown as Response
    }) as typeof fetch

    const promise = translate('hello world')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await promise).toBeNull()
    expect(aborted).toBe(true)
  })
})
