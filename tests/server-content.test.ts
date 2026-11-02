import { describe, expect, it, vi } from 'vitest'
import worker, { type Env } from '../server/src/index'
import { MAX_CONTENT_BYTES } from '../server/src/content'

const ID = 'abcdefghijk'
const BASE = 'https://api.example'
const metadata = { [ID]: { videoId: ID, title: 'Example' } }
function setup(plan = 'pro_plus') {
  const objects = new Map<string, string>([
    ['content-db.json', JSON.stringify(metadata)],
    [`cues/${ID}.json`, JSON.stringify([{ start: 0, dur: 1, text: 'Hello' }])]
  ])
  const get = vi.fn(async (key: string, options: { onlyIf: Headers }) => {
    const value = objects.get(key)
    if (!value) return null
    const props = { httpEtag: '"etag"', uploaded: new Date(0) }
    if (options.onlyIf.get('If-None-Match') === '"etag"') return props
    return { ...props, body: new Response(value).body }
  })
  const put = vi.fn(async (key: string, value: Uint8Array) => {
    objects.set(key, new TextDecoder().decode(value))
    return { httpEtag: '"new"' }
  })
  const env = {
    ADMIN_TOKEN: 'admin', CONTENT_UPLOAD_TOKEN: 'uploader', CONTENT_BUCKET: { get, put },
    YTENSUB_KV: {
      getWithMetadata: vi.fn(async (key: string) => ({
        value: key === 'token:valid' ? 'a@example.com' : null,
        metadata: { expiresAt: Date.now() + 20 * 86400000 }
      })),
      get: vi.fn(async (key: string) => key === 'user:a@example.com' ?
        { email: 'a@example.com', plan, expiresAt: Date.now() + 86400000 } : null)
    }
  } as unknown as Env
  const request = (url: string, init?: RequestInit) => worker.fetch(new Request(BASE + url, init), env)
  return { request, get, put }
}

describe('Worker content gateway', () => {
  it('streams public metadata and supports ETag/HEAD without any account writes', async () => {
    const { request } = setup()
    const response = await request('/content/content-db.json')
    expect(await response.json()).toEqual(metadata)
    expect(response.headers.get('Cache-Control')).toBe('no-cache')
    expect(response.headers.get('ETag')).toBe('"etag"')
    expect((await request('/content/content-db.json', { headers: { 'If-None-Match': '"etag"' } })).status).toBe(304)
    expect(await (await request('/content/content-db.json', { method: 'HEAD' })).text()).toBe('')
  })

  it('does not expose subtitles, unrelated objects or arbitrary paths through public metadata', async () => {
    const { request, get } = setup()
    for (const path of [`/content/cues/${ID}.json`, '/content/releases/latest.yml', '/content/other.json']) {
      expect((await request(path)).status).toBe(404)
    }
    expect(get).not.toHaveBeenCalled()
  })

  it('checks subtitle login and plan before touching R2, including conditional requests', async () => {
    const { request, get } = setup('pro')
    expect((await request(`/cues/${ID}`)).status).toBe(401)
    expect((await request(`/cues/${ID}`, { headers: { Authorization: 'Bearer valid', 'If-None-Match': '"etag"' } })).status).toBe(403)
    expect(get).not.toHaveBeenCalled()
    const paid = setup()
    const response = await paid.request(`/cues/${ID}`, { headers: { Authorization: 'Bearer valid' } })
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=3600')
    expect(await response.json()).toEqual([{ start: 0, dur: 1, text: 'Hello' }])
  })

  it('requires an upload credential and confines its scope to content', async () => {
    const { request, put } = setup()
    const body = JSON.stringify(metadata)
    expect((await request('/admin/content/content-db.json', { method: 'PUT', body })).status).toBe(401)
    const headers = { Authorization: 'Bearer uploader', 'Content-Type': 'application/json' }
    expect((await request('/admin/content/content-db.json', { method: 'PUT', headers, body })).status).toBe(200)
    expect(put).toHaveBeenCalledTimes(1)
    expect((await request('/admin/config', { headers })).status).toBe(401)
  })

  it('rejects malformed/oversized uploads and subtitles embedded in public metadata', async () => {
    const { request, put } = setup()
    const headers = { Authorization: 'Bearer uploader', 'Content-Type': 'application/json' }
    for (const body of ['{', JSON.stringify({ [ID]: { videoId: ID, cues: [] } }), '[]']) {
      expect((await request('/admin/content/content-db.json', { method: 'PUT', headers, body })).status).toBe(400)
    }
    expect((await request('/admin/content/index.json', {
      method: 'PUT', headers: { ...headers, 'Content-Length': String(MAX_CONTENT_BYTES + 1) }, body: '{}'
    })).status).toBe(413)
    expect(put).not.toHaveBeenCalled()
  })

  it('allows desktop CORS PUT and conditional reads', async () => {
    const { request } = setup()
    const response = await request('/admin/content/index.json', { method: 'OPTIONS' })
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('PUT')
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('If-None-Match')
  })
})
