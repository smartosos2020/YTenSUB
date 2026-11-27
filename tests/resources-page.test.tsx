// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { DownloadTask } from '../src/shared/resources'

const mocks = vi.hoisted(() => ({
  resourceSnapshot: vi.fn(), resourceCancelPreview: vi.fn(async () => {}),
  resourceSearch: vi.fn(), resourcePreview: vi.fn(), resourceAdd: vi.fn(async () => {}),
  resourceOpenVideo: vi.fn(), resourceAction: vi.fn(async () => {})
}))
vi.mock('../src/renderer/src/api', () => ({ api: mocks }))
import ResourcesPage from '../src/renderer/src/pages/ResourcesPage'

const settings = { directory: 'C:\\Downloads', downloadLimitKB: 0, uploadLimitKB: 128, seedAfterDownload: false }
const hash = 'a'.repeat(40)
beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation((media: string) => ({ media, matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
})
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear()
  mocks.resourceSnapshot.mockResolvedValue({ settings, tasks: [] })
  mocks.resourceSearch.mockResolvedValue([{ id: hash, name: 'Demo S01E02', magnet: `magnet:?xt=urn:btih:${hash}`, size: 1024, seeders: 4, leechers: 2, added: 0 }])
  mocks.resourcePreview.mockResolvedValue({ token: 'preview', name: 'Demo', infoHash: hash, files: [
    { index: 0, name: 'Episode.mp4', size: 1024 }, { index: 1, name: 'readme.txt', size: 20 }
  ] })
})
afterEach(cleanup)

function Location(): JSX.Element { const location = useLocation(); return <output data-testid="route">{location.pathname}:{location.state?.downloadedVideo?.name}</output> }
async function mount(): Promise<ReturnType<typeof render>> {
  const view = render(<MantineProvider><MemoryRouter initialEntries={['/resources']}><ResourcesPage /><Location /></MemoryRouter></MantineProvider>)
  await act(async () => {})
  return view
}

describe('资源页面关键流程', () => {
  it('搜索与解析不会自动下载，确认文件后才提交选择', async () => {
    const view = await mount()
    fireEvent.change(view.getByRole('textbox', { name: '搜索视频资源' }), { target: { value: 'Demo S01E02' } })
    await act(async () => { fireEvent.click(view.getByRole('button', { name: '搜索' })) })
    expect(mocks.resourcePreview).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(view.getByRole('button', { name: '下载' })) })
    expect(mocks.resourceAdd).not.toHaveBeenCalled()
    expect((await view.findByRole('checkbox', { name: 'Episode.mp4' }) as HTMLInputElement).checked).toBe(true)
    expect((view.getByRole('checkbox', { name: 'readme.txt' }) as HTMLInputElement).checked).toBe(false)
    await act(async () => { fireEvent.click(view.getByRole('button', { name: '开始下载' })) })
    expect(mocks.resourceAdd).toHaveBeenCalledWith('preview', [0])
    expect(view.getByRole('tab', { name: '下载中 (0)' }).getAttribute('aria-selected')).toBe('true')
  })

  it('完成的视频通过本地模块打开，并传递具体视频', async () => {
    const task: DownloadTask = { id: hash, name: 'Demo', directory: settings.directory, state: 'paused', finished: true,
      downloaded: 1024, total: 1024, uploaded: 0, downloadSpeed: 0, uploadSpeed: 0, peers: 0,
      files: [{ index: 0, name: 'Episode.mp4', size: 1024, selected: true, completed: true }] }
    mocks.resourceSnapshot.mockResolvedValue({ settings, tasks: [task] })
    mocks.resourceOpenVideo.mockResolvedValue({ name: 'Episode.mp4', path: 'C:\\Downloads\\Episode.mp4' })
    const view = await mount()
    fireEvent.click(view.getByRole('tab', { name: '已完成 (1)' }))
    await act(async () => { fireEvent.click(view.getByRole('button', { name: '播放' })) })
    expect(mocks.resourceOpenVideo).toHaveBeenCalledWith(hash, 0)
    expect(view.getByTestId('route').textContent).toBe('/local:Episode.mp4')
  })

  it('重启校验时已完成条目留在已完成页，显示校验进度并等待校验后播放', async () => {
    const task: DownloadTask = { id: hash, name: 'Demo', directory: settings.directory, state: 'initializing', finished: false, previouslyFinished: true,
      downloaded: 256, total: 1024, uploaded: 0, downloadSpeed: 0, uploadSpeed: 0, peers: 0,
      files: [{ index: 0, name: 'Episode.mp4', size: 1024, selected: true, completed: false }] }
    mocks.resourceSnapshot.mockResolvedValue({ settings, tasks: [task] })
    const view = await mount()
    expect(view.getByRole('tab', { name: '下载中 (0)' })).toBeTruthy()
    fireEvent.click(view.getByRole('tab', { name: '已完成 (1)' }))
    expect(view.getByText('已完成 · 正在校验本地文件')).toBeTruthy()
    expect(view.getByRole('progressbar', { name: 'Demo 本地校验进度' }).getAttribute('value')).toBe('256')
    expect((view.getByRole('button', { name: '校验后播放' }) as HTMLButtonElement).disabled).toBe(true)
    expect(view.queryByRole('button', { name: '暂停' })).toBeNull()
    expect(view.queryByText(/↓/)).toBeNull()

    // A failed completion check must move the task back to the unfinished category.
    mocks.resourceSnapshot.mockResolvedValue({ settings, tasks: [{ ...task, state: 'paused', previouslyFinished: false }] })
    await act(async () => { fireEvent.click(view.getByRole('button', { name: '刷新' })) })
    expect(view.getByRole('tab', { name: '已完成 (0)' })).toBeTruthy()
    fireEvent.click(view.getByRole('tab', { name: '下载中 (1)' }))
    expect(view.getByText('已暂停')).toBeTruthy()
    expect(view.getByRole('progressbar', { name: 'Demo 下载进度' })).toBeTruthy()
  })
})
