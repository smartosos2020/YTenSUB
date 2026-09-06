/**
 * 把 content-db.json 上传到 Cloudflare R2（S3 兼容）。
 * 由 scripts/content-pipeline.mjs 在管线完成后调用；缺配置时静默跳过。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

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
  const { S3Client, PutObjectCommand } = require2('@aws-sdk/client-s3')
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY }
  })
  const body = fs.readFileSync(dbPath)
  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: 'content-db.json',
      Body: body,
      ContentType: 'application/json',
      CacheControl: 'public, max-age=300'
    })
  )
  onLog(`快照已上传 R2（${(body.length / 1024).toFixed(0)}KB）`)
}

// 直接运行：node scripts/upload-snapshot.mjs
if (process.argv[1] && process.argv[1].endsWith('upload-snapshot.mjs')) {
  const dbPath = path.join(process.env.APPDATA || '', 'YTenSUB', 'content-db.json')
  uploadSnapshot(dbPath, (m) => console.log(m)).catch((e) => {
    console.error('上传失败：', e)
    process.exitCode = 1
  })
}
