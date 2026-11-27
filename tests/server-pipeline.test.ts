import { describe, expect, it, vi } from 'vitest'
import { pipelineStore } from './helpers/pipeline-store'
import { handlePipelineControl } from '../server/src/pipeline-control'
import worker, { type Env } from '../server/src/index'

const BASE = 'https://api.example'
const RUNNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const NOW = 1_800_000_000_000
function setup() {
  const bucket = pipelineStore()
  const call = (route = '', body?: unknown, now = NOW) => handlePipelineControl(bucket, new Request(BASE + '/admin/pipeline' + route, {
    method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) })
  }), now)
  const poll = (body = {}, now = NOW) => call('/poll', { runnerId: RUNNER, ...body }, now)
  return { bucket, call, poll }
}

describe('管理后台管线任务', () => {
  it('所有控制端点需要管理 token，离线不能创建任务', async () => {
    const { bucket, call } = setup()
    const env = { ADMIN_TOKEN: 'secret', CONTENT_BUCKET: bucket } as Env
    for (const route of ['', '/run', '/poll']) {
      const response = await worker.fetch(new Request(BASE + '/admin/pipeline' + route, { method: route ? 'POST' : 'GET' }), env)
      expect(response.status).toBe(401)
    }
    expect((await call('/run', {})).status).toBe(503)
    expect(await (await call()).json()).toMatchObject({ online: false, job: null })
  })

  it('按钮只排队，由执行端领取后反馈进度和成功结果', async () => {
    const { call, poll } = setup()
    expect((await poll()).status).toBe(200)
    const queued = await call('/run', {})
    expect(queued.status).toBe(202)
    const { job } = await queued.json() as { job: { id: string } }
    expect(await (await call()).json()).toMatchObject({ online: true, job: { state: 'queued' } })
    const claimed = await (await poll()).json()
    expect(claimed).toMatchObject({ job: { id: job.id, state: 'running', runnerId: RUNNER } })
    await poll({ jobId: job.id, report: { state: 'running', message: '正在采集频道', added: 2 } }, NOW + 10000)
    expect(await (await call('', undefined, NOW + 10000)).json()).toMatchObject({ job: { state: 'running', added: 2, message: '正在采集频道' } })
    await poll({ jobId: job.id, report: { state: 'success', published: true, added: 4, total: 100 } }, NOW + 20000)
    expect(await (await call('', undefined, NOW + 20000)).json()).toMatchObject({ job: { state: 'success', published: true, total: 100, finishedAt: NOW + 20000 } })
    expect((await call('/run', {}, NOW + 21000)).status).toBe(202)
  })

  it('并发点击只能创建一项任务，其他采集端不能重复领取', async () => {
    const { call, poll } = setup()
    await poll()
    const responses = await Promise.all([call('/run', {}), call('/run', {})])
    expect(responses.map(response => response.status).sort()).toEqual([202, 409])
    expect((await poll()).status).toBe(200)
    expect((await poll({ runnerId: OTHER })).status).toBe(409)
    expect((await poll({ runnerId: OTHER }, NOW + 50000)).status).toBe(409)
  })

  it('保留部分完成状态与分类统计，拒绝未知或非法统计字段', async () => {
    const { call, poll } = setup()
    await poll(); await call('/run', {})
    const { job } = await (await poll()).json() as { job: { id: string } }
    await poll({ jobId: job.id, report: { state: 'partial', added: 2, refreshed: 3, repaired: -1, published: true,
      stats: { captionAttempts: 5, captionSucceeded: 4, captionFailures: 1, failureReasons: { 'network-error': 1, secret: 999 }, command: 1 } } })
    const status = await (await call()).json() as { job: Record<string, unknown> }
    expect(status).toMatchObject({ job: { state: 'partial', added: 2, refreshed: 3, published: true, stats: { captionAttempts: 5, captionFailures: 1, failureReasons: { 'network-error': 1 } } } })
    expect(status.job.repaired).toBeUndefined()
    expect(JSON.stringify(status)).not.toContain('secret')
    expect(JSON.stringify(status)).not.toContain('command')
    expect((await call('/run', {})).status).toBe(202)
  })

  it('内容概况接口也支持部分完成与安全的统计字段', async () => {
    const put = vi.fn<(key: string, value: string) => Promise<void>>().mockResolvedValue(undefined)
    const env = { ADMIN_TOKEN: 'secret', YTENSUB_KV: { put } } as unknown as Env
    const response = await worker.fetch(new Request(BASE + '/admin/content-status', { method: 'POST', headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'partial', startedAt: NOW, refreshed: 2, added: -5, total: 100, stats: { captionFailures: 1, failureReasons: { 'network-error': 1 } } }) }), env)
    expect(response.status).toBe(200)
    const saved = JSON.parse(put.mock.calls[0][1])
    expect(saved).toMatchObject({ state: 'partial', refreshed: 2, total: 100, stats: { captionFailures: 1 } })
    expect(saved.added).toBeUndefined()
  })

  it('旧任务/错误任务的状态上报不能覆盖新任务', async () => {
    const { call, poll } = setup()
    await poll(); await call('/run', {}); await poll()
    await poll({ jobId: 'old-job', report: { state: 'success', published: true } })
    expect(await (await call()).json()).toMatchObject({ job: { state: 'running' } })
  })

  it('执行端失联后显示失败，恢复后可重试且旧任务上报无效', async () => {
    const { call, poll } = setup()
    await poll(); await call('/run', {})
    const { job } = await (await poll()).json() as { job: { id: string } }
    expect(await (await call('', undefined, NOW + 91000)).json()).toMatchObject({ online: false, job: { state: 'failed' } })
    await poll({ runnerId: OTHER }, NOW + 91000)
    expect((await call('/run', {}, NOW + 92000)).status).toBe(202)
    await poll({ jobId: job.id, report: { state: 'success' } }, NOW + 92000)
    expect(await (await call('', undefined, NOW + 92000)).json()).toMatchObject({ job: { state: 'queued' } })
  })

  it('限制上报状态与消息长度，非法方法不会触发采集', async () => {
    const { call, poll } = setup()
    expect((await call('/run')).status).toBe(404)
    expect((await poll({ report: { state: 'execute-shell' } })).status).toBe(400)
    expect((await poll({ runnerId: 'bad' })).status).toBe(400)
    expect((await poll({ report: { message: 'a'.repeat(5000) } })).status).toBe(413)
  })
})
