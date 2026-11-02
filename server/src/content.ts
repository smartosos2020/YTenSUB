import type { Headers as WorkerHeaders, R2Bucket } from '@cloudflare/workers-types'

export const MAX_CONTENT_BYTES = 20 * 1024 * 1024
const VIDEO_ID = /^[\w-]{11}$/
const INCREMENT = /^increments\/inc-\d{13,16}\.json$/

export function isMetadataKey(key: string): boolean {
  return key === 'content-db.json' || key === 'index.json' || INCREMENT.test(key)
}

export function isContentKey(key: string): boolean {
  return isMetadataKey(key) || /^cues\/[\w-]{11}\.json$/.test(key)
}

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'ETag, Last-Modified',
  'Content-Type': 'application/json',
  'X-Content-Type-Options': 'nosniff'
}

function error(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...headers, 'Cache-Control': 'no-store' } })
}

/** Called for subtitles only after account/plan authorization. Never redirect to public storage. */
export async function readContent(bucket: R2Bucket, req: Request, key: string, privateContent = false): Promise<Response> {
  if (!isContentKey(key)) return error('not found', 404)
  const conditional = new Headers()
  const etag = req.headers.get('If-None-Match')
  if (etag) conditional.set('If-None-Match', etag)
  const object = await bucket.get(key, { onlyIf: conditional as unknown as WorkerHeaders })
  if (!object) return error('content not found', 404)
  const responseHeaders = new Headers(headers)
  responseHeaders.set('ETag', object.httpEtag)
  responseHeaders.set('Last-Modified', object.uploaded.toUTCString())
  // Mutable snapshot/index must revalidate, so a newly published index never reads a stale snapshot.
  responseHeaders.set('Cache-Control', privateContent ? 'private, max-age=3600' :
    INCREMENT.test(key) ? 'public, max-age=86400, immutable' : 'no-cache')
  if (!('body' in object)) return new Response(null, { status: 304, headers: responseHeaders })
  if (req.method === 'HEAD') {
    await object.body.cancel()
    return new Response(null, { headers: responseHeaders })
  }
  return new Response(object.body as unknown as ReadableStream, { headers: responseHeaders })
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Prevent subtitles or arbitrary bucket objects from being exposed through public metadata. */
function validPayload(key: string, value: unknown): boolean {
  if (key.startsWith('cues/')) {
    return Array.isArray(value) && value.every(c => record(c) && typeof c.text === 'string' &&
      typeof c.start === 'number' && Number.isFinite(c.start) && c.start >= 0 &&
      typeof c.dur === 'number' && Number.isFinite(c.dur) && c.dur >= 0)
  }
  if (!record(value)) return false
  if (key === 'index.json') {
    return typeof value.latest === 'number' && Number.isSafeInteger(value.latest) && value.latest >= 0 &&
      Array.isArray(value.increments) && value.increments.length <= 20 && value.increments.every((inc, i, all) =>
        record(inc) && Number.isSafeInteger(inc.ts) && typeof inc.ts === 'number' && inc.ts > 0 &&
        inc.ts <= (value.latest as number) && (i === 0 || inc.ts > all[i - 1].ts) &&
        inc.file === `increments/inc-${inc.ts}.json` && INCREMENT.test(inc.file as string) &&
        typeof inc.count === 'number' && Number.isSafeInteger(inc.count) && inc.count >= 0)
  }
  return Object.entries(value).every(([id, video]) => VIDEO_ID.test(id) && record(video) &&
    video.videoId === id && !('cues' in video))
}

/** The router checks the upload credential before reading a potentially large body. */
export async function writeContent(bucket: R2Bucket, req: Request, key: string): Promise<Response> {
  if (!isContentKey(key)) return error('invalid content key', 400)
  if (!req.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return error('JSON required', 415)
  if (Number(req.headers.get('Content-Length')) > MAX_CONTENT_BYTES) return error('content too large', 413)
  if (!req.body) return error('JSON required', 400)
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_CONTENT_BYTES) {
      await reader.cancel()
      return error('content too large', 413)
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  let payload: unknown
  try { payload = JSON.parse(new TextDecoder().decode(bytes)) } catch { return error('invalid JSON', 400) }
  if (!validPayload(key, payload)) return error('invalid content payload', 400)
  const object = await bucket.put(key, bytes, { httpMetadata: { contentType: 'application/json' } })
  return new Response(JSON.stringify({ ok: true, key, etag: object?.httpEtag }), {
    headers: { ...headers, 'Cache-Control': 'no-store' }
  })
}
