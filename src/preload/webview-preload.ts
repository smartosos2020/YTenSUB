/**
 * 注入 youtube.com 页面的 preload（在 webview guest 中运行）。
 * 职责：
 *  - 检测 SPA 导航到 /watch?v=... 并通知宿主
 *  - 周期上报视频播放进度（DOM 与页面共享，可直接读 video 元素）
 * 字幕内容的提取由宿主通过 webview.executeJavaScript 在页面主世界完成
 * （preload 运行在隔离世界，读不到 window.ytInitialPlayerResponse）。
 */
import { ipcRenderer } from 'electron'

let lastKey: string | null = null

function currentVideoId(): string | null {
  if (!location.pathname.startsWith('/watch')) return null
  return new URLSearchParams(location.search).get('v')
}

function send(msg: Record<string, unknown>): void {
  ipcRenderer.sendToHost('ytensub', msg)
}

function check(): void {
  const videoId = currentVideoId()
  const key = videoId ? `watch:${videoId}` : 'other'
  if (key !== lastKey) {
    lastKey = key
    send({ kind: 'page', videoId, url: location.href })
  }
}

setInterval(() => {
  check()
  if (lastKey?.startsWith('watch:')) {
    const v = document.querySelector('video')
    send({ kind: 'time', time: v ? v.currentTime : 0 })
  }
}, 300)

window.addEventListener('yt-navigate-finish', () => setTimeout(check, 0))
document.addEventListener('DOMContentLoaded', check)

// 转发 guest 页面内的点击：宿主侧的翻译弹窗据此关闭
//（webview 内的事件不会冒泡到宿主文档）
document.addEventListener('mousedown', () => send({ kind: 'guest-mousedown' }), true)

// webview 获得焦点时 Esc 只进 guest，转发给宿主处理（关弹窗 / 退出全屏）
document.addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'Escape') send({ kind: 'esc' })
  },
  true
)

// 鼠标侧键（后退/前进）与 Alt+←/→：只导航 guest（YouTube）自身历史，
// preventDefault 阻止 Chromium 默认行为连带宿主一起跳
document.addEventListener(
  'mousedown',
  (e) => {
    if (e.button === 3 || e.button === 4) e.preventDefault()
  },
  true
)
document.addEventListener(
  'mouseup',
  (e) => {
    if (e.button === 3) {
      e.preventDefault()
      history.back()
    } else if (e.button === 4) {
      e.preventDefault()
      history.forward()
    }
  },
  true
)
document.addEventListener(
  'keydown',
  (e) => {
    if (!e.altKey || e.ctrlKey || e.shiftKey || e.metaKey) return
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      history.back()
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      history.forward()
    }
  },
  true
)
check()
