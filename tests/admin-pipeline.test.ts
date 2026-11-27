// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ADMIN_PAGE } from '../server/src/admin-page'

beforeEach(() => { document.documentElement.innerHTML = ADMIN_PAGE; localStorage.clear() })
afterEach(() => { document.documentElement.innerHTML = ''; vi.restoreAllMocks() })

function mount() {
  let snapshot = { online: false, lastSeenAt: null, job: null as null | Record<string, unknown> }
  const fetchFn = vi.fn(async (url: string) => {
    if (url === '/admin/pipeline/run') {
      snapshot = { ...snapshot, job: { id: 'new', state: 'queued', requestedAt: Date.now(), updatedAt: Date.now(), message: '等待领取' } }
      return Response.json(snapshot, { status: 202 })
    }
    if (url === '/admin/pipeline') return Response.json(snapshot)
    return Response.json({})
  })
  const script = /<script>([\s\S]*?)<\/script>/.exec(ADMIN_PAGE)![1]
  const controls = new Function('document', 'localStorage', 'fetch', 'setInterval', script + '; return {loadPipelineStatus, startContentPipeline};')(
    document, localStorage, fetchFn, vi.fn()
  ) as { loadPipelineStatus(): Promise<void>; startContentPipeline(): Promise<void> }
  return { controls, fetchFn, setSnapshot: (next: typeof snapshot) => { snapshot = next } }
}

describe('管理后台管线按钮', () => {
  it('离线禁用，在线可提交，排队期间不能重复触发并显示状态', async () => {
    const { controls, fetchFn, setSnapshot } = mount()
    const button = document.getElementById('pipelineRun') as HTMLButtonElement
    await controls.loadPipelineStatus()
    expect(button.disabled).toBe(true)
    await controls.startContentPipeline()
    expect(fetchFn.mock.calls.filter(([url]) => url === '/admin/pipeline/run')).toHaveLength(0)
    setSnapshot({ online: true, lastSeenAt: null, job: null })
    await controls.loadPipelineStatus()
    expect(button.disabled).toBe(false)
    await controls.startContentPipeline()
    expect(button.disabled).toBe(true)
    expect(button.textContent).toContain('等待采集端')
    expect(document.getElementById('pipelineMsg')!.textContent).toContain('任务已提交')
    await controls.startContentPipeline()
    expect(fetchFn.mock.calls.filter(([url]) => url === '/admin/pipeline/run')).toHaveLength(1)
    expect(document.getElementById('pipelineOut')!.textContent).toContain('排队中')
  })

  it('部分完成时显示新增、刷新和失败分类，允许再次提交', async () => {
    const { controls, setSnapshot } = mount()
    setSnapshot({ online: true, lastSeenAt: null, job: { state: 'partial', requestedAt: Date.now(), updatedAt: Date.now(), added: 1, refreshed: 2, repaired: 0,
      stats: { candidates: 5, captionAttempts: 3, captionSucceeded: 2, captionFailures: 1, failureReasons: { 'network-error': 1 } } } })
    await controls.loadPipelineStatus()
    expect((document.getElementById('pipelineRun') as HTMLButtonElement).disabled).toBe(false)
    const text = document.getElementById('pipelineOut')!.textContent
    expect(text).toContain('部分完成')
    expect(text).toContain('刷新旧条目')
    expect(text).toContain('字幕请求失败')
    expect(text).toContain('网络异常')
  })
})
