// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MantineProvider } from '@mantine/core'
import { DEFAULT_SETTINGS } from '../src/shared/types'

// api.ts 在模块加载时读取 window.api：必须先装好 mock 再动态 import App
const apiMock = {
  settingsGet: vi.fn(async () => ({ ...DEFAULT_SETTINGS })),
  settingsSet: vi.fn(async (p: unknown) => p),
  vocabList: vi.fn(async () => []),
  vocabAdd: vi.fn(async (v: unknown) => v),
  vocabRemove: vi.fn(async () => undefined),
  vocabReview: vi.fn(async () => undefined),
  vocabVisualGet: vi.fn(async () => null),
  vocabVisualCacheSize: vi.fn(async () => 0),
  vocabVisualCacheClear: vi.fn(async () => undefined),
  localPlaylistList: vi.fn(async () => []),
  localPickVideo: vi.fn(async () => ({
    path: 'C:\\video\\episode.mp4', url: 'ytensub-media://test', name: 'episode.mp4',
    query: 'episode', extension: 'mp4', size: 1024, hash: null,
    sidecarSubtitle: { fileName: 'episode.srt', text: '1\n00:00:00,000 --> 00:10:00,000\nHello world\n' }
  })),
  favList: vi.fn(async () => []),
  favAdd: vi.fn(async (f: unknown) => f),
  favRemove: vi.fn(async () => undefined),
  favIs: vi.fn(async () => false),
  favMove: vi.fn(async () => undefined),
  favUpdateMeta: vi.fn(async () => undefined),
  favEstimateLevel: vi.fn(async () => null),
  folderList: vi.fn(async () => []),
  folderAdd: vi.fn(async () => undefined),
  folderRemove: vi.fn(async () => undefined),
  translate: vi.fn(async () => null),
  translateZhBatch: vi.fn(async (t: string[]) => t.map(() => null)),
  dictPronounce: vi.fn(async () => null),
  shadowingGet: vi.fn(async () => null),
  shadowingGenerate: vi.fn(async () => ({ error: 'no-captions' })),
  llmTest: vi.fn(async () => ({ ok: false, ms: 1 })),
  translateContext: vi.fn(async () => null),
  syncStart: vi.fn(async () => null),
  syncStop: vi.fn(async () => {}),
  captionsFetchText: vi.fn(async () => null),
  captionsGetCache: vi.fn(async () => null),
  captionsPutCache: vi.fn(async () => {}),
  captionsCacheSize: vi.fn(async () => 0),
  captionsClearCache: vi.fn(async () => {}),
  appVersion: vi.fn(async () => '0.0.0-test'),
  updateInstall: vi.fn(),
  updateCheck: vi.fn(async () => 'latest' as const),
  updateOpenReleases: vi.fn(),
  openExternal: vi.fn(async () => undefined),
  onUpdateAvailable: vi.fn(() => () => {}),
  onUpdateDownloaded: vi.fn(() => () => {}),
  onUpdateProgress: vi.fn(() => () => {}),
  onUpdateError: vi.fn(() => () => {}),
  saveTextFile: vi.fn(async () => null),
  dataExport: vi.fn(async () => null),
  dataImport: vi.fn(async () => null),
  windowMinimize: vi.fn(),
  windowToggleMaximize: vi.fn(),
  windowClose: vi.fn(),
  onWindowMaximizeChanged: vi.fn(() => () => {}),
  getWebviewPreloadPath: vi.fn(async () => 'file:///mock/preload.js'),
  authGet: vi.fn(async () => null),
  authSet: vi.fn(async () => undefined),
  entitlementGet: vi.fn(async () => null),
  entitlementSet: vi.fn(async () => undefined)
}
;(window as unknown as { api: unknown }).api = apiMock

// jsdom 没有 matchMedia
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia
}

vi.mock('../src/renderer/src/hooks/useLocalAudioFallback', () => ({
  useLocalAudioFallback: () => ({ kind: 'idle' })
}))

const { act, cleanup, fireEvent, render } = await import('@testing-library/react')
const { default: App } = await import('../src/renderer/src/App')

beforeEach(() => {
  window.location.hash = '/browse'
  localStorage.clear()
  vi.clearAllMocks()
})
afterEach(cleanup)

describe('App 冒烟', () => {
  it('启动渲染不崩溃，侧栏/标题栏就位', () => {
    const { container } = render(<App />)
    expect(container.querySelector('.app')).toBeTruthy()
    expect(container.querySelector('.titlebar')).toBeTruthy()
    expect(container.querySelector('.sidebar')).toBeTruthy()
  })

  it('切换菜单只暂停本地视频，返回后保留同一个播放器、进度和字幕', async () => {
    const view = render(<MantineProvider><App /></MantineProvider>)
    await act(async () => { fireEvent.click(view.getByRole('link', { name: '本地' })) })
    await act(async () => { fireEvent.click(view.getByRole('button', { name: '打开视频' })) })
    fireEvent.click(view.getByRole('button', { name: /开始播放/ }))
    const video = view.container.querySelector('video')!
    let paused = false
    const pause = vi.fn(() => { paused = true })
    Object.defineProperties(video, {
      paused: { configurable: true, get: () => paused },
      pause: { configurable: true, value: pause }
    })
    video.currentTime = 137.5
    fireEvent.timeUpdate(video)

    for (const menu of ['浏览', '收藏']) {
      await act(async () => { fireEvent.click(view.getByRole('link', { name: menu })) })
      expect(video.isConnected).toBe(true)
      expect(video.paused).toBe(true)
      expect((view.container.querySelector('.local-holder') as HTMLElement).style.display).toBe('none')
      await act(async () => { fireEvent.click(view.getByRole('link', { name: '本地' })) })
      expect(view.container.querySelector('video')).toBe(video)
      expect(video.currentTime).toBe(137.5)
      expect(video.paused).toBe(true)
      expect(view.container.querySelector('.caption-line')?.textContent).toBe('Hello world')
      expect(view.container.querySelector('.local-file-info')?.textContent).toContain('episode.srt')
    }
    expect(apiMock.localPickVideo).toHaveBeenCalledOnce()
    expect(pause).toHaveBeenCalledTimes(2)
    view.unmount()
    expect(video.isConnected).toBe(false)
  })
})
