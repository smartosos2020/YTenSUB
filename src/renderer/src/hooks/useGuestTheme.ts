import { useCallback, useEffect, useRef } from 'react'
import type { WebviewTag } from 'electron'
import { Theme } from '../../../shared/types'
import { resolveTheme } from '../theme'

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
      // webview 已挂载但 dom-ready 未触发时，getURL/insertCSS/executeJavaScript 会同步抛错，
      // 必须整体包 try/catch（未捕获会让 React 整树卸载黑屏）
      try {
        // 'system' 先解析为实际明暗（主进程 themeSource=system 时已模拟好系统媒体查询）
        const resolved = resolveTheme(t)
        // guest 页面滚动条：与宿主一致的细圆角样式，颜色随主题。
        // 渲染进程 CSS 管不到 webview 内部，必须注入；重复注入后者覆盖前者。
        // 注意要在下面的 isLoading 早退之前注入，否则初次加载会回落到默认滚动条
        const thumb = resolved === 'night' ? '#333837' : '#d9d9d9'
        const thumbHover = resolved === 'night' ? '#4a514d' : '#bdbdbd'
        wv.insertCSS(
          // YouTube 在 html/body 设了标准 scrollbar-color，会禁用 ::-webkit-scrollbar
          // 自定义，必须先重置为 auto；下面的 webkit 规则才生效
          'html, body { scrollbar-color: auto !important; scrollbar-width: auto !important; }' +
            '::-webkit-scrollbar { width: 9px !important; height: 9px !important; }' +
            '::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: transparent !important; }' +
            `::-webkit-scrollbar-thumb { background: ${thumb} !important; border-radius: 999px !important; border: 2px solid transparent !important; background-clip: content-box !important; }` +
            `::-webkit-scrollbar-thumb:hover { background: ${thumbHover} !important; }`
        ).catch(() => {})
        if (!wv.getURL().includes('youtube.com') || wv.isLoading()) return
        wv.executeJavaScript(
          `(() => {
        const app = document.querySelector('ytd-app')
        const appBg = app ? getComputedStyle(app).backgroundColor : ''
        const pageDark = document.documentElement.hasAttribute('dark') || appBg === 'rgb(15, 15, 15)'
        const mismatch = pageDark !== ${JSON.stringify(resolved === 'night')}
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
      } catch {
        // webview 未就绪：跳过本次同步，dom-ready/page 消息时会再断言
      }
    },
    [wvRef]
  )

  // 主题变化（设置页保存后经 SETTINGS_CHANGED 事件传来）：更新 ref 并同步 guest 页面
  useEffect(() => {
    themeRef.current = theme
    applyGuestTheme(theme)
  }, [theme, applyGuestTheme])

  // 'system' 模式下系统明暗切换时，重新断言 guest 页面主题
  useEffect(() => {
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const reassert = (): void => applyGuestTheme('system')
    mq.addEventListener('change', reassert)
    return () => mq.removeEventListener('change', reassert)
  }, [theme, applyGuestTheme])

  return { themeRef, applyGuestTheme }
}
