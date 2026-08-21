/**
 * 主窗字幕（视频浮层）可选字体。key 存入设置；css 为完整 font-family 栈，
 * 西文字体需带中文回退，保证中文字幕行也能正常显示。
 */
export interface CaptionFont {
  key: string
  label: string
  /** 空字符串表示跟随界面默认等宽字体 */
  css: string
}

export const CAPTION_FONTS: CaptionFont[] = [
  { key: 'default', label: '默认（等宽）', css: '' },
  { key: 'yahei', label: '微软雅黑', css: "'Microsoft YaHei', sans-serif" },
  { key: 'simsun', label: '宋体', css: 'SimSun, serif' },
  { key: 'simhei', label: '黑体', css: 'SimHei, sans-serif' },
  { key: 'kaiti', label: '楷体', css: 'KaiTi, serif' },
  { key: 'arial', label: 'Arial', css: "Arial, 'Microsoft YaHei', sans-serif" },
  { key: 'times', label: 'Times New Roman', css: "'Times New Roman', SimSun, serif" },
  { key: 'georgia', label: 'Georgia', css: "Georgia, 'Times New Roman', serif" },
  { key: 'consolas', label: 'Consolas', css: "Consolas, 'Microsoft YaHei', monospace" }
]

/** 按 key 取 font-family 栈；未知 key 回退默认（空串 = 跟随界面字体） */
export function captionFontCss(key: string): string {
  return CAPTION_FONTS.find((f) => f.key === key)?.css ?? ''
}
