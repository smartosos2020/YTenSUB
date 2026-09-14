/**
 * 精选内容管线（Phase 0 单机版）运行器：
 * 把 src/main/curated-run.ts（TS）用 esbuild 打包成临时 cjs 再执行。
 *
 * 用法：npm run pipeline
 * 前置：项目根目录 .env 里有 YOUTUBE_API_KEY；resources/dict.json 已构建
 * 输出：%APPDATA%/YTenSUB/content-db.json
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

// .env 手工解析（不引依赖）
const envText = fs.existsSync(path.join(root, '.env'))
  ? fs.readFileSync(path.join(root, '.env'), 'utf8')
  : ''
const apiKey = /YOUTUBE_API_KEY=(\S+)/.exec(envText)?.[1]
if (!apiKey) {
  console.error('缺少 YOUTUBE_API_KEY：请在项目根目录 .env 写入 YOUTUBE_API_KEY=...')
  process.exit(1)
}
// C1 用户频道合并（可选）：缺任一键就当纯种子跑，不报错
const apiUrl = /AUTH_API_URL=(\S+)/.exec(envText)?.[1]
const adminToken = /ADMIN_TOKEN=(\S+)/.exec(envText)?.[1]

const seedPath = path.join(root, 'scripts', 'seed-channels.json')

/** 拉取已审核用户频道 → 种子条目；失败/未配置均降级为纯种子（返回 []） */
async function loadUserSeeds() {
  if (!apiUrl || !adminToken) {
    console.log('未配置 AUTH_API_URL/ADMIN_TOKEN：跳过用户频道合并（纯种子模式）')
    return []
  }
  try {
    const { fetchApprovedUserChannels, userChannelsToSeeds } = await import('./user-channels.mjs')
    const approved = await fetchApprovedUserChannels(apiUrl, adminToken)
    const fileSeeds = JSON.parse(fs.readFileSync(seedPath, 'utf8'))
    const extra = userChannelsToSeeds(approved, fileSeeds)
    console.log(
      `合并用户频道：${extra.length} 个（服务端审核通过 ${approved.length} 个）` +
        (extra.length ? '：' + extra.map((s) => s.handle).join('、') : '')
    )
    return extra
  } catch (e) {
    console.log(`用户频道拉取失败，按纯种子继续：${String(e)}`)
    return []
  }
}

const dictPath = path.join(root, 'resources', 'dict.json')
if (!fs.existsSync(dictPath)) {
  console.error('缺少 resources/dict.json：先运行 npm run build:dict')
  process.exit(1)
}

const require2 = createRequire(import.meta.url)
const esbuild = require2('esbuild')
const outFile = path.join(root, 'node_modules', '.cache', 'curated-run.cjs')
esbuild.buildSync({
  entryPoints: [path.join(root, 'src', 'main', 'curated-run.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: outFile,
  logLevel: 'warning'
})

const { runCuratedPipeline } = require2(outFile)
const dbPath = path.join(process.env.APPDATA || os.homedir(), 'YTenSUB', 'content-db.json')

loadUserSeeds()
  .then((extraSeeds) =>
    runCuratedPipeline({
      apiKey,
      dbPath,
      seedPath,
      dictPath,
      extraSeeds,
      fetchFn: (u, i) => fetch(u, i),
      onLog: (m) => console.log(m)
    })
  )
  .then(async () => {
    // 管线成功后上传快照到 R2（未配置 R2_* 时静默跳过）
    const { uploadSnapshot } = await import('./upload-snapshot.mjs')
    await uploadSnapshot(dbPath, (m) => console.log(m))
  })
  .catch((e) => {
    console.error('管线失败：', e)
    process.exitCode = 1
  })
