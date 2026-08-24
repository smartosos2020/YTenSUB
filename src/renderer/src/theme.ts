import { Theme } from '../../shared/types'

/** 'system' 主题解析为实际明暗 */
export function resolveTheme(theme: Theme): 'night' | 'day' {
  if (theme !== 'system') return theme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'day'
}

interface AccentSet {
  accent: string
  dim: string
  soft: string
  strong: string
  glow: string
}

/** 强调色板：key 存设置项，日夜各一套（夜间高亮 + 白天深调） */
export const ACCENTS: { key: string; label: string; dot: string }[] = [
  { key: 'green', label: '荧光绿', dot: '#00ff9f' },
  { key: 'blue', label: '蓝色', dot: '#3ea6ff' },
  { key: 'purple', label: '紫色', dot: '#b98cff' },
  { key: 'orange', label: '橙色', dot: '#ffaa33' },
  { key: 'pink', label: '粉色', dot: '#ff6ba8' },
  { key: 'red', label: '红色', dot: '#ff6b64' }
]

const ACCENT_VARS: Record<string, { night: AccentSet; day: AccentSet }> = {
  green: {
    night: { accent: '#00ff9f', dim: '#0a5c3e', soft: 'rgba(0,255,159,.08)', strong: 'rgba(0,255,159,.22)', glow: 'rgba(0,255,159,.4)' },
    day: { accent: '#00794c', dim: '#5d8a74', soft: 'rgba(0,121,76,.08)', strong: 'rgba(0,121,76,.2)', glow: 'transparent' }
  },
  blue: {
    night: { accent: '#3ea6ff', dim: '#1c4d7a', soft: 'rgba(62,166,255,.1)', strong: 'rgba(62,166,255,.25)', glow: 'rgba(62,166,255,.4)' },
    day: { accent: '#007aff', dim: '#7ba7d4', soft: 'rgba(0,122,255,.08)', strong: 'rgba(0,122,255,.2)', glow: 'transparent' }
  },
  purple: {
    night: { accent: '#b98cff', dim: '#4b3670', soft: 'rgba(185,140,255,.1)', strong: 'rgba(185,140,255,.25)', glow: 'rgba(185,140,255,.4)' },
    day: { accent: '#7d3fc8', dim: '#a98fd4', soft: 'rgba(125,63,200,.08)', strong: 'rgba(125,63,200,.2)', glow: 'transparent' }
  },
  orange: {
    night: { accent: '#ffaa33', dim: '#8a5a1c', soft: 'rgba(255,170,51,.1)', strong: 'rgba(255,170,51,.25)', glow: 'rgba(255,170,51,.4)' },
    day: { accent: '#c25e00', dim: '#d4a87b', soft: 'rgba(194,94,0,.08)', strong: 'rgba(194,94,0,.2)', glow: 'transparent' }
  },
  pink: {
    night: { accent: '#ff6ba8', dim: '#8a2c56', soft: 'rgba(255,107,168,.1)', strong: 'rgba(255,107,168,.25)', glow: 'rgba(255,107,168,.4)' },
    day: { accent: '#c2256b', dim: '#d48fad', soft: 'rgba(194,37,107,.08)', strong: 'rgba(194,37,107,.2)', glow: 'transparent' }
  },
  red: {
    night: { accent: '#ff6b64', dim: '#8a3229', soft: 'rgba(255,107,100,.1)', strong: 'rgba(255,107,100,.25)', glow: 'rgba(255,107,100,.4)' },
    day: { accent: '#c0392b', dim: '#d48a7b', soft: 'rgba(192,57,43,.08)', strong: 'rgba(192,57,43,.2)', glow: 'transparent' }
  }
}

/** 把主题和强调色写到 <html>：data-theme 切换明暗变量组，accent 覆盖强调色系 */
export function applyTheme(theme: Theme, accent?: string): void {
  const resolved = resolveTheme(theme)
  document.documentElement.dataset.theme = resolved
  const set = ACCENT_VARS[accent ?? 'green']?.[resolved] ?? ACCENT_VARS.green[resolved]
  const el = document.documentElement
  el.style.setProperty('--accent', set.accent)
  el.style.setProperty('--accent-dim', set.dim)
  el.style.setProperty('--accent-soft', set.soft)
  el.style.setProperty('--accent-strong', set.strong)
  el.style.setProperty('--glow', set.glow)
}
