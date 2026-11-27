import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { readContentEnv } from './content-api.mjs'
import { acquirePipelineLock } from './pipeline-lock.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HEARTBEAT_MS = 10_000
// Stop the child before the server's 90-second ownership lease can expire.
const DISCONNECT_MS = 60_000

export function readJobReport(filename, jobId) {
  try {
    const report = JSON.parse(fs.readFileSync(filename, 'utf8'))
    return report.jobId === jobId ? report : null
  } catch { return null }
}

export async function runPipelineRunner({ env = readContentEnv(), fetchFn = fetch, spawnFn = spawn,
  lockFn = acquirePipelineLock, intervalMs = HEARTBEAT_MS, disconnectMs = DISCONNECT_MS, signal } = {}) {
  const base = new URL(env.AUTH_API_URL || 'https://ytensub-api.smartosos2020.workers.dev')
  if (base.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw new Error('Pipeline API requires HTTPS')
  if (!env.ADMIN_TOKEN || !env.YOUTUBE_API_KEY) throw new Error('执行端需要 .env 中的 ADMIN_TOKEN 和 YOUTUBE_API_KEY')
  if (!fs.existsSync(path.join(root, 'resources', 'dict.json'))) throw new Error('请先运行 npm run build:dict')
  const release = await lockFn('runner')
  const runnerId = randomUUID()
  const contentDir = path.join(env.APPDATA || os.homedir(), 'YTenSUB')
  fs.mkdirSync(contentDir, { recursive: true })
  const statusPath = path.join(contentDir, 'pipeline-status.json')
  let child, jobId, outcome, closed, resolveClosed
  let lastContact = Date.now(), stopped = false
  const log = message => console.log(`[${new Date().toISOString()}] ${message}`)
  const stop = () => { stopped = true; child?.kill() }
  signal?.addEventListener('abort', stop, { once: true })
  const disconnectGuard = setInterval(() => {
    if (child && Date.now() - lastContact >= disconnectMs) {
      log('执行端失联超过 60 秒，停止管线以避免重复执行')
      child.kill()
    }
  }, Math.min(1000, disconnectMs / 2))
  const start = id => {
    // Fixed entry point and arguments. Browser input cannot become a shell command.
    jobId = id; outcome = undefined
    let output
    closed = new Promise(resolve => { resolveClosed = resolve })
    try {
      output = fs.openSync(path.join(contentDir, 'pipeline.log'), 'a')
      child = spawnFn(process.execPath, [path.join(root, 'scripts', 'content-pipeline.mjs')], {
        cwd: root, windowsHide: true, shell: false, stdio: ['ignore', output, output],
        env: { ...process.env, ...env, PIPELINE_JOB_ID: id }
      })
      child.once('error', () => { outcome = { state: 'failed', message: '本机无法启动采集进程' }; child = undefined; resolveClosed() })
      child.once('exit', code => {
        const report = readJobReport(statusPath, id)
        outcome = code === 0 && ['success', 'partial'].includes(report?.state) ? report
          : { ...report, state: 'failed', message: code === 0 ? '管线未报告成功，请查看本机日志' : '管线进程退出：' + (report?.message || `退出码 ${code}`) }
        child = undefined; resolveClosed()
      })
      log('已接收任务 ' + id)
    } catch {
      outcome = { state: 'failed', message: '本机无法启动采集进程' }
      resolveClosed()
    } finally { if (output !== undefined) fs.closeSync(output) }
  }
  log('执行端已启动，仅在管理后台点击运行后采集')
  try {
    while (!stopped && !signal?.aborted) {
      try {
        const report = jobId ? outcome || { ...readJobReport(statusPath, jobId), state: 'running' } : undefined
        const response = await fetchFn(new URL('/admin/pipeline/poll', base), {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.ADMIN_TOKEN}` },
          body: JSON.stringify({ runnerId, jobId, report })
        })
        if (!response.ok) throw new Error(`管线接口 HTTP ${response.status}`)
        const result = await response.json()
        lastContact = Date.now()
        if (jobId && (result.job?.id !== jobId || !outcome && result.job?.state !== 'running')) {
          child?.kill()
          if (closed) await closed
          jobId = undefined; outcome = undefined
        } else if (outcome && result.job?.state === outcome.state) {
          log('任务结束：' + outcome.state)
          jobId = undefined; outcome = undefined
        } else if (!jobId && result.job?.state === 'running' && result.job.runnerId === runnerId && !stopped) {
          start(result.job.id)
        }
      } catch (error) { log(error instanceof Error ? error.message : '管线接口暂不可用') }
      try { await delay(intervalMs, undefined, { signal }) } catch { break }
    }
  } finally {
    stop(); clearInterval(disconnectGuard)
    if (closed) await closed
    signal?.removeEventListener('abort', stop)
    await release()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController()
  process.once('SIGINT', () => controller.abort())
  process.once('SIGTERM', () => controller.abort())
  runPipelineRunner({ signal: controller.signal }).catch(error => { console.error(error.message); process.exitCode = 1 })
}
