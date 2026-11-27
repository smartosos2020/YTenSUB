import type { R2Bucket } from '@cloudflare/workers-types'
import { readPipelineMetrics, type PipelineMetrics } from '../../src/shared/pipeline'

const KEY = 'operations/pipeline-control.json'
const ONLINE_MS = 45_000
const LEASE_MS = 90_000
export interface PipelineJob extends Partial<PipelineMetrics> {
  id: string
  state: 'queued' | 'running' | 'success' | 'partial' | 'failed'
  requestedAt: number
  updatedAt: number
  startedAt?: number
  finishedAt?: number
  runnerId?: string
  leaseUntil?: number
  message: string
  added?: number
  total?: number
  published?: boolean
}
interface Control {
  runner?: { id: string; seenAt: number }
  job?: PipelineJob
}

function reply(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}
function active(job: PipelineJob | undefined): boolean { return job?.state === 'queued' || job?.state === 'running' }
function expire(control: Control, now: number): void {
  const job = control.job
  if (active(job) && (job!.leaseUntil ?? job!.requestedAt + LEASE_MS) <= now) {
    Object.assign(job!, { state: 'failed', finishedAt: now, updatedAt: now, message: '采集端失联，任务已停止；恢复连接后可重新运行' })
  }
}
function view(control: Control, now: number): { online: boolean; lastSeenAt: number | null; job: PipelineJob | null } {
  return { online: !!control.runner && now - control.runner.seenAt < ONLINE_MS, lastSeenAt: control.runner?.seenAt ?? null, job: control.job ?? null }
}

/** R2 conditional writes serialize button clicks and claims across Worker instances. */
export async function handlePipelineControl(bucket: R2Bucket, req: Request, now = Date.now()): Promise<Response> {
  const route = new URL(req.url).pathname
  const isStatus = route === '/admin/pipeline' && req.method === 'GET'
  const isRun = route === '/admin/pipeline/run' && req.method === 'POST'
  const isPoll = route === '/admin/pipeline/poll' && req.method === 'POST'
  if (!isStatus && !isRun && !isPoll) return reply({ error: 'not found' }, 404)
  let body: Record<string, unknown> = {}
  if (isPoll) {
    try {
      const text = await req.text()
      if (text.length > 4096) return reply({ error: 'request too large' }, 413)
      body = JSON.parse(text)
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('bad body')
    } catch { return reply({ error: 'bad request' }, 400) }
    if (typeof body.runnerId !== 'string' || !/^[a-f0-9-]{36}$/.test(body.runnerId)) return reply({ error: 'bad runnerId' }, 400)
    if (body.report !== undefined && (!body.report || typeof body.report !== 'object' || Array.isArray(body.report))) return reply({ error: 'bad report' }, 400)
    const state = (body.report as Record<string, unknown> | undefined)?.state
    if (state !== undefined && !['running', 'success', 'partial', 'failed'].includes(String(state))) return reply({ error: 'bad report state' }, 400)
  }
  for (let attempt = 0; attempt < 8; attempt++) {
    const object = await bucket.get(KEY)
    const control: Control = object ? await object.json() : {}
    expire(control, now)
    if (isStatus) return reply(view(control, now))
    if (isRun) {
      if (active(control.job)) return reply({ error: '已有管线任务正在排队或执行，请等待完成', ...view(control, now) }, 409)
      if (!view(control, now).online) return reply({ error: '采集端未连接，请先在采集电脑启动执行端', ...view(control, now) }, 503)
      control.job = { id: crypto.randomUUID(), state: 'queued', requestedAt: now, updatedAt: now, message: '已提交，等待本机采集端接收' }
    } else {
      const runnerId = body.runnerId as string
      if (control.runner?.id !== runnerId && view(control, now).online ||
          control.job?.state === 'running' && control.job.runnerId !== runnerId) {
        return reply({ error: '另一个采集端正在连接或执行任务' }, 409)
      }
      control.runner = { id: runnerId, seenAt: now }
      const job = control.job
      if (job?.state === 'running' && job.runnerId === runnerId && body.jobId === job.id) {
        const report = body.report as Record<string, unknown> | undefined
        job.updatedAt = now
        job.leaseUntil = now + LEASE_MS
        if (report) {
          if (typeof report.message === 'string') job.message = report.message.slice(0, 500)
          Object.assign(job, readPipelineMetrics(report))
          if (typeof report.published === 'boolean') job.published = report.published
          if (report.state === 'success' || report.state === 'partial' || report.state === 'failed') {
            job.state = report.state; job.finishedAt = now
          }
        }
      } else if (job?.state === 'queued' && !body.jobId) {
        Object.assign(job, { state: 'running', runnerId, startedAt: now, updatedAt: now, leaseUntil: now + LEASE_MS, message: '本机已接收，准备采集频道' })
      }
    }
    const saved = await bucket.put(KEY, JSON.stringify(control), {
      onlyIf: object ? { etagMatches: object.etag } : { etagDoesNotMatch: '*' },
      httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' }
    })
    if (!saved) continue
    const result = view(control, now)
    // A poll is also the claim acknowledgement. Never send another runner's job to execute.
    if (isPoll && result.job?.runnerId !== body.runnerId) result.job = null
    return reply(result, isRun ? 202 : 200)
  }
  return reply({ error: '状态正在更新，请稍后重试' }, 409)
}
