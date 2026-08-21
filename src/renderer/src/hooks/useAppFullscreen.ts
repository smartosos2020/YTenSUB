import { useCallback, useEffect, useRef, useState } from 'react'
import type { WebviewTag } from 'electron'

export interface AppFullscreenState {
  fsMode: boolean
  fsModeRef: React.MutableRefObject<boolean>
  /** 拦截原生全屏后忽略其 leave 事件 */
  fsIgnoreLeaveRef: React.MutableRefObject<boolean>
  enterFs: () => void
  exitFs: () => void
}

/** 应用级全屏：guest 播放器铺满视口，隐藏宿主界面元素，保留字幕浮层 */
export function useAppFullscreen(wvRef: React.RefObject<WebviewTag | null>): AppFullscreenState {
  const [fsMode, setFsMode] = useState(false)
  const fsModeRef = useRef(false)
  const fsIgnoreLeaveRef = useRef(false)

  /** 进入应用级全屏 */
  const enterFs = useCallback((): void => {
    fsModeRef.current = true
    setFsMode(true)
    wvRef.current?.executeJavaScript("document.body.classList.add('el-fs')").catch(() => {})
  }, [wvRef])

  /** 退出应用级全屏：同时让 YouTube 自身退出全屏状态，恢复页面布局 */
  const exitFs = useCallback((): void => {
    fsModeRef.current = false
    setFsMode(false)
    wvRef.current
      ?.executeJavaScript(
        "document.body.classList.remove('el-fs');" +
          'if (document.fullscreenElement) void document.exitFullscreen();' +
          "var p = document.getElementById('movie_player');" +
          "if (p && p.classList.contains('ytp-fullscreen')) {" +
          "  var b = p.querySelector('.ytp-fullscreen-button');" +
          '  if (b) b.click();' +
          '}'
      )
      .catch(() => {})
  }, [wvRef])

  // 全屏时隐藏侧栏/导航栏/字幕面板（通过 body class）
  useEffect(() => {
    document.body.classList.toggle('el-app-fs', fsMode)
    return () => document.body.classList.remove('el-app-fs')
  }, [fsMode])

  return { fsMode, fsModeRef, fsIgnoreLeaveRef, enterFs, exitFs }
}
