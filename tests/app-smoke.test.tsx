// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../src/shared/types'

// api.ts 在模块加载时读取 window.api：必须先装好 mock 再动态 import App
const apiMock = {
  settingsGet: vi.fn(async () => ({ ...DEFAULT_SETTINGS })),
  settingsSet: vi.fn(async (p: unknown) => p),
  vocabList: vi.fn(async () => []),
  vocabAdd: vi.fn(async (v: unknown) => v),
  vocabRemove: vi.fn(async () => undefined),
  vocabReview: vi.fn(async () => undefined),
  favList: vi.fn(async () => []),
  favAdd: vi.fn(async (f: unknown) => f),
  favRemove: vi.fn(async () => undefined),
  favIs: vi.fn(async () => false),
  folderList: vi.fn(async () => []),
  folderAdd: vi.fn(async () => undefined),
  folderRemove: vi.fn(async () => undefined),
  translate: vi.fn(async () => null),
  translateZhBatch: vi.fn(async (t: string[]) => t.map(() => null)),
  dictPronounce: vi.fn(async () => null),
  shadowingGet: vi.fn(async () => null),
  shadowingGenerate: vi.fn(async () => ({ error: 'no-captions' })),
  llmTest: vi.fn(async () => ({ ok: false, ms: 1 })),
  appVersion: vi.fn(async () => '0.0.0-test'),
  updateInstall: vi.fn(),
  updateCheck: vi.fn(),
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
  getWebviewPreloadPath: vi.fn(async () => 'file:///mock/preload.js')
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

const { render } = await import('@testing-library/react')
const { default: App } = await import('../src/renderer/src/App')

describe('App 冒烟', () => {
  it('启动渲染不崩溃，侧栏/标题栏就位', () => {
    const { container } = render(<App />)
    expect(container.querySelector('.app')).toBeTruthy()
    expect(container.querySelector('.titlebar')).toBeTruthy()
    expect(container.querySelector('.sidebar')).toBeTruthy()
  })
})
