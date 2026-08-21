import { useCallback, useEffect, useRef } from 'react'
import type { WebviewTag } from 'electron'
import { Theme } from '../../../shared/types'

/**
 * 把应用主题同步到 YouTube。主进程已用 nativeTheme.themeSource 模拟 prefers-color-scheme，
 * 因此整页加载时 YouTube 原生就是正确主题；但已加载的页面不会自己跟随。
 * 此时不刷新页面（刷新会丢播放进度、且和 YouTube 的 themeRefresh 生命周期打架，
 * 实测会导致 masthead/左侧菜单渲染残缺），而是探测渲染主题，不一致就套反色滤镜瞬时切换
 * （Dark Reader 同款 invert + hue-rotate，媒体元素二次反色还原），下一次整页加载
 * 若已是原生正确主题则自动摘掉滤镜。
 */
export function useGuestTheme(
  wvRef: React.RefObject<WebviewTag | null>,
  theme: Theme
): {
  /** 供 webview 事件回调读最新主题 */
  themeRef: React.MutableRefObject<Theme>
  applyGuestTheme: (t: Theme) => void
} {
  const themeRef = useRef<Theme>(theme)

  const applyGuestTheme = useCallback(
    (t: Theme): void => {
      const wv = wvRef.current
      if (!wv) return
      try {
        if (!wv.getURL().includes('youtube.com') || wv.isLoading()) return
      } catch {
        return
      }
      wv.executeJavaScript(
        `(() => {
        const app = document.querySelector('ytd-app')
        const appBg = app ? getComputedStyle(app).backgroundColor : ''
        const pageDark = document.documentElement.hasAttribute('dark') || appBg === 'rgb(15, 15, 15)'
        const mismatch = pageDark !== ${JSON.stringify(t === 'night')}
        const ID = 'ytensub-theme-inv'
        let st = document.getElementById(ID)
        if (mismatch) {
          if (!st) {
            st = document.createElement('style')
            st.id = ID
            st.textContent =
              'html { filter: invert(1) hue-rotate(180deg) !important; }' +
              'video, img, canvas { filter: invert(1) hue-rotate(180deg) !important; }'
            document.documentElement.appendChild(st)
          }
        } else if (st) {
          st.remove()
        }
      })()`
      ).catch(() => {})
    },
    [wvRef]
  )

  // 主题变化（设置页保存后经 SETTINGS_CHANGED 事件传来）：更新 ref 并同步 guest 页面
  useEffect(() => {
    themeRef.current = theme
    applyGuestTheme(theme)
  }, [theme, applyGuestTheme])

  return { themeRef, applyGuestTheme }
}
