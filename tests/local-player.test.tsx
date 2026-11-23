// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { DEFAULT_SETTINGS } from '../src/shared/types'

const apiMock = vi.hoisted(() => ({
  settingsGet: vi.fn(),
  vocabList: vi.fn(async () => []),
  localPlaylistList: vi.fn(async () => []),
  localPickVideo: vi.fn(async () => ({
    path: 'C:\\video\\episode.mp4', url: 'ytensub-media://test', name: 'episode.mp4',
    query: 'episode', extension: 'mp4', size: 1024, hash: null,
    sidecarSubtitle: { fileName: 'episode.srt', text: '1\n00:00:00,000 --> 00:10:00,000\nHello world\n' }
  })),
  translate: vi.fn(async () => ({ text: 'Hello', translation: '你好', source: 'local' }))
}))

vi.mock('../src/renderer/src/api', () => ({
  api: apiMock, SETTINGS_CHANGED_EVENT: 'settings-changed', VOCAB_CHANGED_EVENT: 'vocab-changed'
}))
vi.mock('../src/renderer/src/hooks/useLocalAudioFallback', () => ({
  useLocalAudioFallback: () => ({ kind: 'idle' })
}))

import LocalPage from '../src/renderer/src/pages/LocalPage'

beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn()
  }))
})

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  vi.clearAllMocks()
  apiMock.settingsGet.mockResolvedValue({ ...DEFAULT_SETTINGS, hoverTranslate: true })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

async function openPlayer() {
  const view = render(<MantineProvider><LocalPage isActive /></MantineProvider>)
  await act(async () => {})
  await act(async () => { fireEvent.click(view.getByRole('button', { name: '打开视频' })) })
  fireEvent.click(view.getByRole('button', { name: /开始播放/ }))
  const video = view.container.querySelector('video')!
  let paused = false
  const play = vi.fn(async () => { paused = false })
  const pause = vi.fn(() => { paused = true })
  Object.defineProperties(video, {
    paused: { configurable: true, get: () => paused },
    play: { configurable: true, value: play },
    pause: { configurable: true, value: pause },
    getBoundingClientRect: { configurable: true, value: () => new DOMRect(0, 0, 1200, 800) }
  })
  const word = view.container.querySelector('.caption-line .word')!
  return { ...view, video, play, pause, word }
}

async function advance(ms: number): Promise<void> {
  await act(async () => { vi.advanceTimersByTime(ms) })
}

describe('本地播放器交互', () => {
  it('点击画面暂停，再点击恢复，控制条点击不重复切换', async () => {
    const { video, play, pause } = await openPlayer()
    fireEvent.click(video, { detail: 1, clientY: 200 })
    await advance(250)
    expect(video.paused).toBe(true)
    fireEvent.click(video, { detail: 1, clientY: 200 })
    await advance(250)
    expect(video.paused).toBe(false)
    fireEvent.click(video, { detail: 1, clientY: 780 })
    await advance(250)
    expect(pause).toHaveBeenCalledTimes(1)
    expect(play).toHaveBeenCalledTimes(1)
  })

  it('双击画面只切换全屏，取消待执行的单击', async () => {
    const { container, video, pause } = await openPlayer()
    const fullscreen = vi.fn(async () => {})
    container.querySelector('.local-video-wrap')!.requestFullscreen = fullscreen
    fireEvent.click(video, { detail: 1, clientY: 200 })
    fireEvent.click(video, { detail: 2, clientY: 200 })
    fireEvent.doubleClick(video, { detail: 2, clientY: 200 })
    await advance(300)
    expect(fullscreen).toHaveBeenCalledOnce()
    expect(pause).not.toHaveBeenCalled()
  })

  it('悬停单词显示翻译，换词保留播放状态，移入弹窗不关闭，离开后恢复', async () => {
    const { container, video, word, play } = await openPlayer()
    fireEvent.mouseEnter(word)
    expect(video.paused).toBe(true)
    await advance(300)
    expect(container.querySelector('.popup-translation')?.textContent).toBe('你好')
    const nextWord = container.querySelectorAll('.caption-line .word')[1]
    fireEvent.mouseLeave(word, { relatedTarget: nextWord })
    fireEvent.mouseEnter(nextWord, { relatedTarget: word })
    await advance(300)
    expect(container.querySelector('.popup-word')?.textContent).toBe('world')
    const popup = container.querySelector('.translate-popup')!
    fireEvent.mouseLeave(nextWord, { relatedTarget: popup })
    fireEvent.mouseEnter(popup, { relatedTarget: nextWord })
    await advance(500)
    expect(container.querySelector('.translate-popup')).toBeTruthy()
    expect(video.paused).toBe(true)
    fireEvent.mouseLeave(popup)
    await advance(400)
    expect(container.querySelector('.translate-popup')).toBeNull()
    expect(play).toHaveBeenCalledOnce()
  })

  it('原本暂停的视频，在悬停翻译结束后仍然暂停', async () => {
    const { container, video, word, play, pause } = await openPlayer()
    pause()
    fireEvent.mouseEnter(word)
    await advance(300)
    fireEvent.mouseLeave(word)
    await advance(400)
    expect(container.querySelector('.translate-popup')).toBeNull()
    expect(video.paused).toBe(true)
    expect(play).not.toHaveBeenCalled()
  })

  it('点击悬停弹窗对应的单词可固定弹窗，离开字幕不会关闭', async () => {
    const { container, word, video } = await openPlayer()
    fireEvent.mouseEnter(word)
    await advance(300)
    fireEvent.click(word)
    fireEvent.mouseLeave(word)
    await advance(500)
    expect(container.querySelector('.translate-popup')).toBeTruthy()
    expect(video.paused).toBe(true)
  })

  it('取词弹窗打开后点击画面，可以关闭弹窗并恢复播放', async () => {
    const { container, video, word } = await openPlayer()
    fireEvent.click(word)
    expect(video.paused).toBe(true)
    fireEvent.mouseDown(video, { detail: 1, clientY: 200 })
    fireEvent.click(video, { detail: 1, clientY: 200 })
    await advance(250)
    expect(container.querySelector('.translate-popup')).toBeNull()
    expect(video.paused).toBe(false)
  })

  it('关闭悬停翻译设置时，只暂停字幕，不自动查询单词', async () => {
    apiMock.settingsGet.mockResolvedValue({ ...DEFAULT_SETTINGS, hoverTranslate: false })
    const { container, word } = await openPlayer()
    fireEvent.mouseEnter(word)
    await advance(500)
    expect(container.querySelector('.translate-popup')).toBeNull()
    expect(apiMock.translate).not.toHaveBeenCalled()
  })

  it('离开页面取消取词弹窗的恢复操作，回来后仍暂停并保留进度', async () => {
    const { container, video, word, play, rerender } = await openPlayer()
    video.currentTime = 123
    fireEvent.mouseEnter(word)
    await advance(300)
    expect(container.querySelector('.translate-popup')).toBeTruthy()
    fireEvent.mouseLeave(word)
    rerender(<MantineProvider><LocalPage isActive={false} /></MantineProvider>)
    await advance(500)
    expect(play).not.toHaveBeenCalled()
    expect(video.paused).toBe(true)
    expect(container.querySelector('.translate-popup')).toBeNull()
    rerender(<MantineProvider><LocalPage isActive /></MantineProvider>)
    expect(container.querySelector('video')).toBe(video)
    expect(video.currentTime).toBe(123)
    expect(video.paused).toBe(true)
  })

  it('离开页面取消待执行的单击恢复，隐藏时拒绝自动播放和延迟取词', async () => {
    const { container, video, word, play, pause, rerender } = await openPlayer()
    pause()
    fireEvent.click(video, { detail: 1, clientY: 200 })
    fireEvent.mouseEnter(word)
    rerender(<MantineProvider><LocalPage isActive={false} /></MantineProvider>)
    await advance(500)
    expect(play).not.toHaveBeenCalled()
    expect(container.querySelector('.translate-popup')).toBeNull()
    const pauses = pause.mock.calls.length
    fireEvent.play(video)
    expect(pause).toHaveBeenCalledTimes(pauses + 1)
  })
})
