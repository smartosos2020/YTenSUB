/** Publish metadata, increments and subtitles exclusively through the Worker API. */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createContentApi, readContentEnv } from './content-api.mjs'

const INDEX_KEEP = 20

export async function uploadSnapshot(dbPath, onLog, options = {}) {
  const env = readContentEnv()
  const api = options.api ?? createContentApi({
    apiUrl: env.AUTH_API_URL || 'https://ytensub-api.smartosos2020.workers.dev',
    uploadToken: env.CONTENT_UPLOAD_TOKEN || env.ADMIN_TOKEN
  })
  if (!fs.existsSync(dbPath)) throw new Error('content-db.json 不存在，无法发布')
  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'))
  const prevPath = dbPath.replace(/\.json$/, '.prev.json')
  const prev = fs.existsSync(prevPath) ? JSON.parse(fs.readFileSync(prevPath, 'utf8')) : {}
  let changed = Object.fromEntries(Object.entries(db).filter(([id, entry]) =>
    !prev[id] || JSON.stringify(prev[id]) !== JSON.stringify(entry)))
  const metadata = entries => Object.fromEntries(Object.entries(entries).map(([id, { cues, ...video }]) => [id, video]))
  const index = await api.getJson('index.json', { latest: 0, increments: [] })
  if (!Number.isSafeInteger(index.latest) || !Array.isArray(index.increments)) throw new Error('Invalid remote content index')
  // A new/empty remote must receive every subtitle even if a local baseline already exists.
  if (index.latest === 0) changed = { ...db }
  const ts = Math.max(Date.now(), index.latest + 1)
  const removed = Object.keys(prev).some(id => !db[id])

  // Publish the index last. Failure leaves the old index and local baseline intact.
  let cueCount = 0
  for (const [videoId, video] of Object.entries(changed)) {
    if (video.cues?.length) {
      await api.put(`cues/${videoId}.json`, video.cues)
      cueCount++
      if (cueCount % 50 === 0) onLog(`Worker 字幕已上传 ${cueCount} 个`)
    }
  }
  if (Object.keys(changed).length || removed || index.latest === 0) {
    const file = `increments/inc-${ts}.json`
    await api.put(file, metadata(changed))
    await api.put('content-db.json', metadata(db))
    // Retain only the newest increment on removal, forcing older clients to bootstrap.
    index.increments = [...(removed ? [] : index.increments), { ts, file, count: Object.keys(changed).length }].slice(-INDEX_KEEP)
    index.latest = ts
    await api.put('index.json', index)
  }
  fs.writeFileSync(prevPath + '.tmp', JSON.stringify(db), 'utf8')
  fs.renameSync(prevPath + '.tmp', prevPath)
  onLog(`已通过 Worker 发布：全量 ${(Buffer.byteLength(JSON.stringify(metadata(db))) / 1024).toFixed(0)}KB；增量 ${Object.keys(changed).length} 条；字幕 ${cueCount} 个`)
  return true
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dbPath = path.join(process.env.APPDATA || '', 'YTenSUB', 'content-db.json')
  uploadSnapshot(dbPath, console.log).catch(error => {
    console.error('上传失败：', error.message)
    process.exitCode = 1
  })
}
