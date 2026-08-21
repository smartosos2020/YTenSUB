import { useEffect } from 'react'
import type { WebviewTag } from 'electron'

/**
 * 键盘 Alt+←/→ 与鼠标侧键（button 3/4 后退/前进）只作用于浏览区 webview，
 * preventDefault 阻止 Chromium 默认行为触发宿主历史/路由跳转。
 * webview 获得焦点时事件进不了宿主文档，由 webview-preload 做同样拦截。
 */
export function useBackForwardNav(wvRef: React.RefObject<WebviewTag | null>): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!e.altKey || e.ctrlKey || e.shiftKey || e.metaKey) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        wvRef.current?.goBack()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        wvRef.current?.goForward()
      }
    }
    const onMouseDown = (e: MouseEvent): void => {
      if (e.button === 3 || e.button === 4) e.preventDefault()
    }
    const onMouseUp = (e: MouseEvent): void => {
      if (e.button === 3) {
        e.preventDefault()
        wvRef.current?.goBack()
      } else if (e.button === 4) {
        e.preventDefault()
        wvRef.current?.goForward()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [wvRef])
}
