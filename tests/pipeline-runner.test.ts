import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { handlePipelineControl } from '../server/src/pipeline-control'
import { pipelineStore } from './helpers/pipeline-store'

const runnerModule = pathToFileURL(path.resolve('scripts/pipeline-runner.mjs')).href
const lockModule = pathToFileURL(path.resolve('scripts/pipeline-lock.mjs')).href
const { runPipelineRunner, readJobReport } = await import(runnerModule)
const { acquirePipelineLock } = await import(lockModule)
afterEach(() => vi.restoreAllMocks())

describe('本机采集执行端', () => {
  it('未配置服务地址时在任何网络或采集操作前停止', async () => {
    const fetchFn = vi.fn()
    const spawnFn = vi.fn()
    await expect(runPipelineRunner({ env: { ADMIN_TOKEN: 'test', YOUTUBE_API_KEY: 'test' }, fetchFn, spawnFn })).rejects.toThrow('AUTH_API_URL')
    expect(fetchFn).not.toHaveBeenCalled()
    expect(spawnFn).not.toHaveBeenCalled()
  })
  it.each(['success', 'partial', 'failed'])('领取后台任务、忽略旧结果并在上报重试后正确保留%s结果', async terminalState => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'ytensub-runner-test-'))
    const statusPath = path.join(appData, 'YTenSUB', 'pipeline-status.json')
    const bucket = pipelineStore()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)
    let submitted = false, retried = false
    const spawnFn = vi.fn((_executable: string, args: string[], options: { shell: boolean; env: Record<string, string> }) => {
      expect(args).toEqual([path.resolve('scripts/content-pipeline.mjs')])
      expect(options.shell).toBe(false)
      fs.writeFileSync(statusPath, JSON.stringify({ jobId: 'old-job', state: 'success', added: 999 }))
      const child = new EventEmitter()
      setTimeout(() => {
        fs.writeFileSync(statusPath, JSON.stringify({ jobId: options.env.PIPELINE_JOB_ID, state: terminalState, added: 2, total: 20, published: terminalState !== 'failed', message: '采集完成' }))
        child.emit('exit', terminalState === 'failed' ? 1 : 0)
      }, 25)
      return Object.assign(child, { kill: () => child.emit('exit', 1) })
    })
    const fetchFn = vi.fn(async (url: URL, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      expect(body.report?.added).not.toBe(999)
      if (body.report?.state === terminalState && !retried) { retried = true; throw new Error('temporary offline') }
      const response = await handlePipelineControl(bucket, new Request(url, init))
      if (!submitted) {
        submitted = true
        expect((await handlePipelineControl(bucket, new Request('https://api.example/admin/pipeline/run', { method: 'POST' }))).status).toBe(202)
      }
      if (body.report?.state === terminalState) setTimeout(() => controller.abort(), 1)
      return response
    })
    try {
      await runPipelineRunner({ env: { AUTH_API_URL: 'https://api.example', ADMIN_TOKEN: 'test', YOUTUBE_API_KEY: 'test', APPDATA: appData },
        spawnFn, fetchFn, lockFn: async () => async () => {}, intervalMs: 5, signal: controller.signal })
      expect(spawnFn).toHaveBeenCalledTimes(1)
      expect(retried).toBe(true)
      const result = await handlePipelineControl(bucket, new Request('https://api.example/admin/pipeline'))
      expect(await result.json()).toMatchObject({ job: { state: terminalState, published: terminalState !== 'failed', added: 2, total: 20 } })
      expect(readJobReport(statusPath, 'different-job')).toBeNull()
    } finally { clearTimeout(timeout); controller.abort(); fs.rmSync(appData, { recursive: true, force: true }) }
  })

  it('连接中断时在租约过期前终止采集，不继续写入内容库', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'ytensub-runner-offline-'))
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)
    const child = new EventEmitter()
    const kill = vi.fn(() => { child.emit('exit', 1); controller.abort() })
    let requests = 0
    try {
      await runPipelineRunner({ env: { AUTH_API_URL: 'https://api.example', ADMIN_TOKEN: 'test', YOUTUBE_API_KEY: 'test', APPDATA: appData },
        spawnFn: () => Object.assign(child, { kill }), lockFn: async () => async () => {}, intervalMs: 5, disconnectMs: 30, signal: controller.signal,
        fetchFn: async (_url: URL, init: RequestInit) => {
          const { runnerId } = JSON.parse(String(init.body))
          if (++requests === 1) return Response.json({ job: { id: 'test-job', state: 'running', runnerId } })
          throw new Error('offline')
        } })
      expect(kill).toHaveBeenCalledTimes(1)
    } finally { clearTimeout(timeout); controller.abort(); fs.rmSync(appData, { recursive: true, force: true }) }
  })

  it('操作系统锁阻止手动 CLI 与后台任务同时采集，释放后可再次运行', async () => {
    const namespace = randomUUID()
    const release = await acquirePipelineLock('collection', namespace)
    try { await expect(acquirePipelineLock('collection', namespace)).rejects.toThrow('已在运行') } finally { await release() }
    const again = await acquirePipelineLock('collection', namespace)
    await again()
  })
})
