import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { uploadSnapshot } from './upload-snapshot.mjs'
import { createContentApi } from './content-api.mjs'

const ID = 'abcdefghijk'
const video = { videoId: ID, title: 'Example', cues: [{ start: 0, dur: 1, text: 'Hello' }] }
function fixture(t, db, previous = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytensub-publish-test-'))
  t.after(() => {
    assert.equal(path.dirname(dir), os.tmpdir())
    assert.ok(path.basename(dir).startsWith('ytensub-publish-test-'))
    fs.rmSync(dir, { recursive: true })
  })
  const file = path.join(dir, 'content-db.json')
  const prev = path.join(dir, 'content-db.prev.json')
  fs.writeFileSync(file, JSON.stringify(db))
  fs.writeFileSync(prev, JSON.stringify(previous))
  return { file, prev }
}

test('publishes subtitles before metadata/index and updates baseline only on success', async t => {
  const { file, prev } = fixture(t, { [ID]: video })
  const calls = []
  const api = { getJson: async () => ({ latest: 0, increments: [] }), put: async (key, value) => calls.push([key, value]) }
  await uploadSnapshot(file, () => {}, { api })
  assert.equal(calls[0][0], `cues/${ID}.json`)
  assert.equal(calls.at(-1)[0], 'index.json')
  const meta = calls.find(([key]) => key === 'content-db.json')[1]
  assert.equal('cues' in meta[ID], false)
  assert.deepEqual(JSON.parse(fs.readFileSync(prev)), { [ID]: video })
})

test('upload failure leaves index and previous baseline untouched', async t => {
  const { file, prev } = fixture(t, { [ID]: video })
  const calls = []
  const api = {
    getJson: async () => ({ latest: 1, increments: [] }),
    put: async key => { calls.push(key); throw new Error('upload failed') }
  }
  await assert.rejects(uploadSnapshot(file, () => {}, { api }), /upload failed/)
  assert.equal(calls.includes('index.json'), false)
  assert.deepEqual(JSON.parse(fs.readFileSync(prev)), {})
})

test('removed entries reset incremental history so old clients bootstrap', async t => {
  const { file } = fixture(t, {}, { [ID]: video })
  let published
  const api = {
    getJson: async () => ({ latest: 1, increments: [{ ts: 1, file: 'increments/inc-1.json', count: 1 }] }),
    put: async (key, value) => { if (key === 'index.json') published = value }
  }
  await uploadSnapshot(file, () => {}, { api })
  assert.equal(published.increments.length, 1)
  assert.equal(published.increments[0].ts, published.latest)
})

test('unchanged data does not rewrite objects', async t => {
  const { file } = fixture(t, { [ID]: video }, { [ID]: video })
  const api = { getJson: async () => ({ latest: 1, increments: [] }), put: async () => assert.fail('unexpected upload') }
  await uploadSnapshot(file, () => {}, { api })
})

test('a missing remote index bootstraps subtitles despite an existing local baseline', async t => {
  const { file } = fixture(t, { [ID]: video }, { [ID]: video })
  const calls = []
  const api = {
    getJson: async (_key, fallback) => fallback,
    put: async key => calls.push(key)
  }
  await uploadSnapshot(file, () => {}, { api })
  assert.equal(calls[0], `cues/${ID}.json`)
  assert.equal(calls.at(-1), 'index.json')
})

test('401 reading the production index aborts instead of treating it as missing', async t => {
  const { file, prev } = fixture(t, { [ID]: video })
  const requests = []
  const api = createContentApi({
    apiUrl: 'https://api.example', uploadToken: 'test',
    fetchFn: async (url, init) => { requests.push([url, init.method]); return new Response('{}', { status: 401 }) }
  })
  await assert.rejects(uploadSnapshot(file, () => {}, { api }), /HTTP 401/)
  assert.equal(requests.length, 1)
  assert.equal(requests[0][1], 'GET')
  assert.deepEqual(JSON.parse(fs.readFileSync(prev)), {})
})
