import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ResourceDownloads } from '../src/main/resource-downloads'
import { isCompletedDownload } from '../src/shared/resources'

const hash = 'a'.repeat(40)
const details = {
  id: 0, info_hash: hash, name: 'Demo', output_folder: path.resolve('downloads/Demo'),
  files: [{ name: 'Episode01.mkv', length: 1024, included: true }, { name: 'Episode02.mkv', length: 2048, included: false }]
}
const complete = { state: 'paused', finished: true, progress_bytes: 1024, total_bytes: 1024, file_progress: [1024, 0], uploaded_bytes: 0 }
const checking = { ...complete, state: 'initializing', finished: false, progress_bytes: 256, file_progress: [0, 0] }
let root: string
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'ytensub-completion-')) })
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(root, { recursive: true, force: true }) })

function manager(stats = complete, metadata = details): {
  downloads: ResourceDownloads
  rpc: ReturnType<typeof vi.fn>
} {
  const downloads = new ResourceDownloads({ binary: 'unused', dataDirectory: root, defaultDirectory: metadata.output_folder })
  vi.spyOn(downloads, 'ensureStarted').mockResolvedValue()
  const rpc = vi.fn(async (route: string) => {
    if (route === '/torrents?with_stats=true') return { torrents: [{ ...metadata, stats }] }
    return metadata
  })
  vi.spyOn(downloads as unknown as { request: (route: string) => Promise<unknown> }, 'request').mockImplementation(rpc)
  return { downloads, rpc }
}

describe('下载完成状态恢复', () => {
  it('冷启动校验期间保留已完成分类，但不能将缓存当作可播放证明', async () => {
    await manager().downloads.snapshot()
    const { downloads } = manager(checking)
    const task = (await downloads.snapshot()).tasks[0]
    expect(isCompletedDownload(task)).toBe(true)
    expect(task).toMatchObject({ state: 'initializing', finished: false, previouslyFinished: true, downloaded: 256 })
    expect(task.files[0].completed).toBe(false)
    await expect(downloads.filePath(hash, 0)).rejects.toThrow('正在校验')
  })

  it.each(['paused', 'live', 'error'])('校验后状态为 %s 且文件不完整时，清除旧完成记录', async (state) => {
    await manager().downloads.snapshot()
    const task = (await manager({ ...checking, state }).downloads.snapshot()).tasks[0]
    expect(isCompletedDownload(task)).toBe(false)
    expect(JSON.parse(await fs.readFile(path.join(root, 'completed.json'), 'utf8'))).toEqual({})
    expect(isCompletedDownload((await manager(checking).downloads.snapshot()).tasks[0])).toBe(false)
  })

  it('首次校验和未完成的下载不被错误归入已完成', async () => {
    expect(isCompletedDownload((await manager(checking).downloads.snapshot()).tasks[0])).toBe(false)
    await manager({ ...checking, state: 'paused' }).downloads.snapshot()
    expect(isCompletedDownload((await manager(checking).downloads.snapshot()).tasks[0])).toBe(false)
  })

  it('同一哈希更换目录或所选文件时，不能复用旧完成记录', async () => {
    await manager().downloads.snapshot()
    const moved = { ...details, output_folder: path.resolve('downloads/Other') }
    expect(isCompletedDownload((await manager(checking, moved).downloads.snapshot()).tasks[0])).toBe(false)
    const changed = { ...details, files: details.files.map((file) => ({ ...file, included: !file.included })) }
    expect(isCompletedDownload((await manager(checking, changed).downloads.snapshot()).tasks[0])).toBe(false)
  })

  it('移除任务也删除其完成记录，重新添加时不复用', async () => {
    const { downloads, rpc } = manager()
    await downloads.snapshot()
    await downloads.action(hash, 'forget')
    expect(rpc).toHaveBeenCalledWith(`/torrents/${hash}/forget`, { method: 'POST' })
    expect(isCompletedDownload((await manager(checking).downloads.snapshot()).tasks[0])).toBe(false)
  })
})
