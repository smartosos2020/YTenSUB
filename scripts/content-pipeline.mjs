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
const apiUrl = /AUTH_API_URL=(\S+)/.exec(envText)?.[1] ?? 'https://ytensub-api.smartosos2020.workers.dev'
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
const contentDir = path.join(process.env.APPDATA || os.homedir(), 'YTenSUB')
const dbPath = path.join(contentDir, 'content-db.json')
const statusPath = path.join(contentDir, 'pipeline-status.json')
const startedAt = Date.now()
let lastStatusReportAt = 0
let pipelineState = {
  state: 'running',
  startedAt,
  updatedAt: startedAt,
  message: '准备采集频道'
}

async function reportStatus(state, patch = {}, force = false) {
  pipelineState = { ...pipelineState, ...patch, state, updatedAt: Date.now() }
  try {
    fs.mkdirSync(contentDir, { recursive: true })
    const tempPath = statusPath + '.tmp'
    fs.writeFileSync(tempPath, JSON.stringify(pipelineState, null, 2), 'utf8')
    fs.renameSync(tempPath, statusPath)
  } catch (e) {
    console.warn('本地管线状态写入失败：', String(e))
  }
  if (!adminToken || (!force && Date.now() - lastStatusReportAt < 30_000)) return
  lastStatusReportAt = Date.now()
  try {
    const response = await fetch(`${apiUrl.replace(/\/$/, '')}/admin/content-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify(pipelineState),
      signal: AbortSignal.timeout(10_000)
    })
    if (!response.ok) console.warn(`Cloudflare 管线状态同步失败：HTTP ${response.status}`)
  } catch (e) {
    console.warn('Cloudflare 管线状态同步失败：', String(e))
  }
}

reportStatus('running', {}, true)
  .then(() => loadUserSeeds())
  .then((extraSeeds) =>
    runCuratedPipeline({
      apiKey,
      dbPath,
      seedPath,
      dictPath,
      extraSeeds,
      fetchFn: (u, i) => fetch(u, i),
      onLog: (m) => {
        console.log(m)
        void reportStatus('running', { message: m })
      }
    })
  )
  .then(async (summary) => {
    // 管线完成后通过 Worker 发布内容；发布失败进入 failed 状态。
    const { uploadSnapshot } = await import('./upload-snapshot.mjs')
    const published = await uploadSnapshot(dbPath, (m) => {
      console.log(m)
      void reportStatus('running', { message: m })
    })
    await reportStatus('success', {
      ...summary,
      published,
      finishedAt: Date.now(),
      message: `完成：新增 ${summary.added} 部，库共 ${summary.total} 部；R2${published ? '已发布' : '未发布'}`
    }, true)
  })
  .catch((e) => {
    console.error('管线失败：', e)
    void reportStatus('failed', { finishedAt: Date.now(), message: String(e).slice(0, 500) }, true)
    process.exitCode = 1
  })
