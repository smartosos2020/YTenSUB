import { useState } from 'react'
import { usePersistentState } from './usePersistentState'

/** 右侧面板宽度默认值与取值范围（px） */
const SIDE_WIDTH_DEFAULT = 320
const SIDE_WIDTH_MIN = 260
const SIDE_WIDTH_MAX = 640

export interface SidePanelState {
  sideTab: 'subs' | 'favs'
  setSideTab: (t: 'subs' | 'favs') => void
  sideCollapsed: boolean
  toggleSide: () => void
  sideWidth: number
  startSideResize: (e: React.MouseEvent) => void
}

/** 右侧标签面板：字幕/收藏切换、收缩（开关在地址栏右侧）、左缘拖拽调宽，状态持久化 */
export function useSidePanel(): SidePanelState {
  const [sideTab, setSideTab] = useState<'subs' | 'favs'>('subs')
  const [sideCollapsed, setSideCollapsed] = usePersistentState<boolean>(
    'ytensub:side-collapsed',
    false
  )
  const [sideWidth, setSideWidth] = usePersistentState<number>(
    'ytensub:side-width',
    SIDE_WIDTH_DEFAULT,
    (w) => w >= SIDE_WIDTH_MIN && w <= SIDE_WIDTH_MAX
  )

  /**
   * 拖拽面板左缘调宽度。拖拽期间必须禁用 webview 的 pointer-events，
   * 否则鼠标进入 webview 后 mousemove 被 guest 吞掉（同字幕浮层拖动）；
   * body 加 side-resizing 关掉宽度过渡，避免面板追着鼠标拖影。
   */
  const startSideResize = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const base = sideWidth
    const wv = document.querySelector<HTMLElement>('.webview')
    if (wv) wv.style.pointerEvents = 'none'
    document.body.classList.add('side-resizing')
    const onMove = (ev: MouseEvent): void => {
      setSideWidth(Math.min(SIDE_WIDTH_MAX, Math.max(SIDE_WIDTH_MIN, base + (startX - ev.clientX))))
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('mouseleave', onUp)
      if (wv) wv.style.pointerEvents = ''
      document.body.classList.remove('side-resizing')
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.addEventListener('mouseleave', onUp)
  }

  return {
    sideTab,
    setSideTab,
    sideCollapsed,
    toggleSide: () => setSideCollapsed(!sideCollapsed),
    sideWidth,
    startSideResize
  }
}
