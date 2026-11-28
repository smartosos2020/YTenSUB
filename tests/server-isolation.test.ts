import { afterEach, describe, expect, it, vi } from 'vitest'
import worker, { type Env } from '../server/src/index'

afterEach(() => vi.unstubAllGlobals())

describe('Local admin service isolation', () => {
  function setup(overrides: Partial<Env> = {}) {
    const put = vi.fn(async () => {})
    const env = { ADMIN_TOKEN: 'local-token', YTENSUB_KV: { put }, ...overrides } as unknown as Env
    const request = (origin = 'http://127.0.0.1:8787') => worker.fetch(new Request(`${origin}/admin/filter-sensitive`, {
      method: 'POST', headers: { Authorization: 'Bearer local-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ on: false })
    }), env)
    return { put, request }
  }

  it('saves locally without contacting any upstream by default', async () => {
    const fetchFn = vi.fn()
    vi.stubGlobal('fetch', fetchFn)
    const { request, put } = setup()
    const response = await request()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, on: false })
    expect(put).toHaveBeenCalledWith('config:filter-sensitive', '0')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('forwards only when the service owner explicitly sets an upstream URL', async () => {
    const fetchFn = vi.fn(async () => Response.json({ on: false }))
    vi.stubGlobal('fetch', fetchFn)
    const { request } = setup({ PRODUCTION_API_URL: 'https://self.example/', PRODUCTION_ADMIN_TOKEN: 'upstream-token' })
    expect((await request()).status).toBe(200)
    expect(fetchFn).toHaveBeenCalledWith('https://self.example/admin/filter-sensitive', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer upstream-token' })
    }))
    fetchFn.mockClear()
    expect((await request('https://deployed.example')).status).toBe(200)
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
