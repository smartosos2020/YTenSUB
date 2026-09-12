/**
 * 精选快照上传到 Cloudflare R2（S3 兼容），"全量引导 + 增量索引"模式：
 *   content-db.json          全量元数据（新客户端引导用，不含字幕）
 *   index.json               增量索引：{ latest, increments: [{ ts, file, count }] }
 *   increments/inc-<ts>.json 本次管线的变化条目（新增或内容有变）
 *   cues/<videoId>.json      每视频字幕（打开时按需取，本就不重复下载）
 *
 * 本地用 content-db.prev.json 记录上一次上传的全量，diff 出本次增量。
 * 由 scripts/content-pipeline.mjs 在管线完成后调用；缺配置时静默跳过。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
/** 索引里最多保留的增量文件数（客户端落后太多就走全量引导） */
const INDEX_KEEP = 20

function readEnv() {
  /** @type {Record<string, string>} */
  const out = {}
  const p = path.join(root, '.env')
  if (!fs.existsSync(p)) return out
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.+)\s*$/.exec(line)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}

export async function uploadSnapshot(dbPath, onLog) {
  const env = readEnv()
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = env
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
    onLog('R2 未配置（.env 缺 R2_*），跳过上传')
    return
  }
  if (!fs.existsSync(dbPath)) {
    onLog('content-db.json 不存在，跳过上传')
    return
  }
  const require2 = createRequire(import.meta.url)
  const { S3Client, PutObjectCommand, GetObjectCommand, NoSuchKey } = require2('@aws-sdk/client-s3')
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY }
  })
  const put = (Key, obj, cacheControl = 'public, max-age=300') =>
    s3.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key,
        Body: JSON.stringify(obj),
        ContentType: 'application/json',
        CacheControl: cacheControl
      })
    )
  const getJson = async (Key, fallback) => {
    try {
      const r = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key }))
      return JSON.parse(await r.Body.transformToString())
    } catch {
      return fallback
    }
  }

  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'))

  // 上一次上传的全量（用于 diff 出本次增量）
  const prevPath = dbPath.replace(/\.json$/, '.prev.json')
  const prev = fs.existsSync(prevPath) ? JSON.parse(fs.readFileSync(prevPath, 'utf8')) : {}
  const changed = {}
  for (const [id, entry] of Object.entries(db)) {
    if (!prev[id] || JSON.stringify(prev[id]) !== JSON.stringify(entry)) changed[id] = entry
  }

  // 元数据全量（剥字幕）——新客户端引导用
  const meta = Object.fromEntries(
    Object.entries(db).map(([k, v]) => {
      const { cues, ...rest } = v
      return [k, rest]
    })
  )
  await put('content-db.json', meta)

  // 增量文件 + 索引
  const ts = Date.now()
  let index = await getJson('index.json', { latest: 0, increments: [] })
  if (!Array.isArray(index.increments)) index.increments = []
  if (Object.keys(changed).length > 0) {
    const metaChanged = Object.fromEntries(
      Object.entries(changed).map(([k, v]) => {
        const { cues, ...rest } = v
        return [k, rest]
      })
    )
    const file = `increments/inc-${ts}.json`
    await put(file, metaChanged, 'public, max-age=86400')
    index.increments.push({ ts, file, count: Object.keys(changed).length })
    index.increments = index.increments.slice(-INDEX_KEEP)
    index.latest = ts
  }
  await put('index.json', index)

  // 每视频字幕：只传本次有变化的（字幕内容本身）
  let cueCount = 0
  for (const [videoId, v] of Object.entries(changed)) {
    if (v.cues?.length) {
      await put(`cues/${videoId}.json`, v.cues, 'public, max-age=86400')
      cueCount++
    }
  }

  // 记录本次全量供下次 diff
  fs.writeFileSync(prevPath, JSON.stringify(db), 'utf8')
  onLog(
    `已上传 R2：全量 ${(JSON.stringify(meta).length / 1024).toFixed(0)}KB；增量 ${Object.keys(changed).length} 条（索引 ${index.increments.length} 个）；字幕 ${cueCount} 个`
  )
}

// 直接运行：node scripts/upload-snapshot.mjs
if (process.argv[1] && process.argv[1].endsWith('upload-snapshot.mjs')) {
  const dbPath = path.join(process.env.APPDATA || '', 'YTenSUB', 'content-db.json')
  uploadSnapshot(dbPath, (m) => console.log(m)).catch((e) => {
    console.error('上传失败：', e)
    process.exitCode = 1
  })
}
