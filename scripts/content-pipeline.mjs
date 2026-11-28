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
import { readContentEnv } from './content-api.mjs'
import { acquirePipelineLock } from './pipeline-lock.mjs'
import { createPipelineNetwork } from './pipeline-network.mjs'
import { finishPipeline } from './pipeline-result.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

const env = readContentEnv()
const apiKey = env.YOUTUBE_API_KEY
if (!apiKey) {
  console.error('缺少 YOUTUBE_API_KEY：请在项目根目录 .env 写入 YOUTUBE_API_KEY=...')
  process.exit(1)
}
// C1 用户频道合并（可选）：缺任一键就当纯种子跑，不报错
const apiUrl = env.AUTH_API_URL
const adminToken = env.ADMIN_TOKEN

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

const releaseLock = await acquirePipelineLock('collection')
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
  ...(env.PIPELINE_JOB_ID ? { jobId: env.PIPELINE_JOB_ID } : {}),
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

let network
await reportStatus('running', {}, true)
  .then(async () => {
    network = createPipelineNetwork(env)
    await reportStatus('running', { message: '检查 YouTube 连接：' + network.description })
    await network.check()
  })
  .then(() => loadUserSeeds())
  .then((extraSeeds) =>
    runCuratedPipeline({
      apiKey,
      dbPath,
      seedPath,
      dictPath,
      extraSeeds,
      fetchFn: (u, i) => network.fetch(u, i),
      onProgress: (metrics) => { void reportStatus('running', metrics) },
      onLog: (m) => {
        console.log(m)
        void reportStatus('running', { message: m })
      }
    })
  )
  .then(async (summary) => {
    const state = await finishPipeline(summary, {
      report: reportStatus,
      publish: async () => {
        const { uploadSnapshot } = await import('./upload-snapshot.mjs')
        return uploadSnapshot(dbPath, (m) => { console.log(m); void reportStatus('running', { message: m }) })
      }
    })
    if (state === 'failed') process.exitCode = 1
  })
  .catch(async (e) => {
    console.error('管线失败：', e)
    await reportStatus('failed', { published: false, finishedAt: Date.now(), message: String(e).slice(0, 500) }, true)
    process.exitCode = 1
  })
  .finally(async () => { await network?.close(); await releaseLock() })
