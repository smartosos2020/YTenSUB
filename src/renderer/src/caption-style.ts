import { CaptionTexture } from '../../shared/types'

/**
 * 字幕浮层质感对应的内联样式（CaptionOverlay 与设置页预览舞台共用）。
 * solid 走 CSS 类提供的绿色细边框；glass 为毛玻璃；none 纯文字加强阴影。
 */
export function captionTextureStyle(
  texture: CaptionTexture,
  opacity: number
): React.CSSProperties {
  if (texture === 'glass') {
    return {
      background: `rgba(10, 12, 11, ${opacity * 0.55})`,
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      border: '1px solid rgba(255, 255, 255, 0.15)',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
    }
  }
  if (texture === 'none') {
    return {
      background: 'transparent',
      border: 'none',
      textShadow: '0 1px 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.6)'
    }
  }
  return { background: `rgba(0, 0, 0, ${opacity})` }
}
