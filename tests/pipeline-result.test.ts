import { describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { emptyPipelineStats } from '../src/shared/pipeline'

const moduleUrl = pathToFileURL(path.resolve('scripts/pipeline-result.mjs')).href
const { finishPipeline } = await import(moduleUrl)
const summary = { state: 'failed', added: 0, refreshed: 0, repaired: 0, total: 1449, stats: emptyPipelineStats(), message: '字幕连接超时' }
describe('采集与发布结果', () => {
  it('采集失败不上传旧库，报告失败与未发布', async () => {
    const publish = vi.fn(), report = vi.fn()
    expect(await finishPipeline(summary, { publish, report })).toBe('failed')
    expect(publish).not.toHaveBeenCalled()
    expect(report).toHaveBeenLastCalledWith('failed', expect.objectContaining({ published: false, total: 1449, stats: summary.stats }), true)
  })
  it('部分完成只发布已采集结果，发布成功也不会将状态改成成功', async () => {
    const publish = vi.fn(async () => true), report = vi.fn()
    expect(await finishPipeline({ ...summary, state: 'partial', added: 2 }, { publish, report })).toBe('partial')
    expect(publish).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenLastCalledWith('partial', expect.objectContaining({ published: true, added: 2 }), true)
  })
  it('发布失败保留采集统计并报告失败，不泄露凭证', async () => {
    const report = vi.fn()
    expect(await finishPipeline({ ...summary, state: 'success', added: 2 }, { publish: async () => { throw new Error('token=secret') }, report })).toBe('failed')
    expect(report).toHaveBeenLastCalledWith('failed', expect.objectContaining({ state: 'failed', published: false, added: 2, total: 1449 }), true)
    expect(JSON.stringify(report.mock.calls)).not.toContain('secret')
  })
  it('正常无新内容时可成功完成，不将零新增误判为故障', async () => {
    const publish = vi.fn(async () => true), report = vi.fn()
    expect(await finishPipeline({ ...summary, state: 'success', message: '完成：无新视频' }, { publish, report })).toBe('success')
    expect(publish).toHaveBeenCalledTimes(1)
  })
})
