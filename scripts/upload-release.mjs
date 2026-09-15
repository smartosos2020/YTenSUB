/**
 * 发版产物上传到 Cloudflare R2（S3 兼容），替代原 GitHub Releases 分发：
 *   releases/latest.yml               electron-updater 的更新清单（no-cache，必须及时生效）
 *   releases/<name>.exe / .blockmap   带版本号的安装包与增量块图（不可变，长缓存）
 *   releases/YTenSUB-Setup-latest.exe 固定名副本，给 README 的永久下载链接（内容会变，no-cache）
 *
 * 由 npm run release 在 electron-builder 打包后调用；缺 R2 配置静默跳过。
 * 上传后回读公开地址的 latest.yml 校验版本号与本地一致。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const PREFIX = 'releases'
const PUBLIC_BASE = 'https://pub-c1dea26a05844ec7959997061df9f305.r2.dev'
const FIXED_NAME = 'YTenSUB-Setup-latest.exe'

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

function parseVersion(ymlText) {
  const m = /^version:\s*(.+)$/m.exec(ymlText)
  return m ? m[1].trim() : ''
}

async function main() {
  const env = readEnv()
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = env
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
    console.log('R2 未配置（.env 缺 R2_*），跳过上传')
    return
  }

  const dist = path.join(root, 'dist')
  const ymlPath = path.join(dist, 'latest.yml')
  if (!fs.existsSync(ymlPath)) {
    console.error('dist/latest.yml 不存在——先 npm run dist 打包')
    process.exitCode = 1
    return
  }
  // 版本号以 latest.yml 为准，只传当前版本的产物（dist/ 里有历史版本的旧 exe，不能乱入）
  const localVersion = parseVersion(fs.readFileSync(ymlPath, 'utf8'))
  if (!localVersion) {
    console.error('latest.yml 里解析不到版本号')
    process.exitCode = 1
    return
  }
  const installer = `YTenSUB Setup ${localVersion}.exe`
  const binaries = [installer, `${installer}.blockmap`].filter((f) =>
    fs.existsSync(path.join(dist, f))
  )
  if (!fs.existsSync(path.join(dist, installer))) {
    console.error(`dist/${installer} 不存在——先 npm run dist 打包`)
    process.exitCode = 1
    return
  }

  // 校验全部通过才建客户端、碰网络
  const require2 = createRequire(import.meta.url)
  const { S3Client, PutObjectCommand } = require2('@aws-sdk/client-s3')
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY }
  })
  const put = (Key, filePath, cacheControl) =>
    s3.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key,
        Body: fs.readFileSync(filePath),
        ContentType: Key.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream',
        CacheControl: cacheControl
      })
    )

  await put(`${PREFIX}/latest.yml`, ymlPath, 'no-cache')
  for (const f of binaries) {
    await put(`${PREFIX}/${f}`, path.join(dist, f), 'public, max-age=86400')
  }
  await put(`${PREFIX}/${FIXED_NAME}`, path.join(dist, installer), 'no-cache')

  // 回读校验：公开地址应立刻能拿到刚传的 latest.yml，且版本与本地一致
  const res = await fetch(`${PUBLIC_BASE}/${PREFIX}/latest.yml`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`回读 latest.yml 失败：HTTP ${res.status}`)
  const remoteVersion = parseVersion(await res.text())
  console.log(`已上传 releases/：latest.yml + ${binaries.length} 个产物 + 固定名副本 ${FIXED_NAME}（源：${installer}）`)
  console.log(
    `回读校验：${PUBLIC_BASE}/${PREFIX}/latest.yml → version ${remoteVersion}` +
      `（本地 ${localVersion}）${remoteVersion === localVersion ? '，一致' : '，不一致！'}`
  )
  if (remoteVersion !== localVersion) process.exitCode = 1
}

main().catch((e) => {
  console.error('上传失败：', e)
  process.exitCode = 1
})
