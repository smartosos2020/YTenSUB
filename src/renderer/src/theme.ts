import { Theme } from '../../shared/types'

/** 把主题写到 <html data-theme="...">，样式表按此切换 CSS 变量 */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
}
