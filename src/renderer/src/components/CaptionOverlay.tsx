import { useEffect, useRef, useState } from 'react'
import { Cue, findActiveCueIndex } from '../../../shared/captions'
import { CaptionTexture } from '../../../shared/types'
import { captionTextureStyle } from '../caption-style'
import WordSpans from './WordSpans'
import { WordSelection } from './SubtitlePanel'

interface Props {
  cues: Cue[]
  time: number
  /** 字幕浮层总开关（侧栏底部按钮，关闭时保持挂载、隐藏渲染，拖动位置不丢） */
  hidden?: boolean
  opacity: number
  /** 英文字幕行字号 px */
  fontSize: number
  /** 中文字幕行字号 px */
  zhSize: number
  /** font-family 栈；空字符串表示跟随界面默认等宽字体 */
  fontFamily: string
  /** 英文行字重：400 常规 / 500 适中 / 700 加粗 / 800 特粗 */
  weight: number
  /** 文字阴影 */
  shadow: boolean
  /** 浮层质感：纯色 / 毛玻璃 / 无边框 */
  texture: CaptionTexture
  /** 是否显示中文字幕 */
  showZh: boolean
  /** 与 cues 等长对齐的中文字幕；null 表示尚未就绪 */
  zhLines: (string | null)[] | null
  /** 已加入生词本的单词（小写），字幕中橙色高亮 */
  knownWords: Set<string>
  onWordSelect: (sel: WordSelection) => void
  /** 悬停/离开字幕（取词时暂停播放防字幕跑走） */
  onCaptionEnter: () => void
  onCaptionLeave: () => void
}

/**
 * 视频画面上的字幕浮层：替代 YouTube 原生字幕，单词可点击翻译。
 * 默认位于进度条上方；按住字幕条空白处可拖动调整位置。
 *
 * 注意：拖动期间必须把 webview 设为 pointer-events:none，否则鼠标进入
 * webview 区域后 mousemove/mouseup 被 guest 页面吞掉，拖拽监听器残留，
 * 再次拖动时偏移量被重复累加（字幕"逃离"鼠标）。
 */
export default function CaptionOverlay({
  cues,
  time,
  hidden = false,
  opacity,
  fontSize,
  zhSize,
  fontFamily,
  weight,
  shadow,
  texture,
  showZh,
  zhLines,
  knownWords,
  onWordSelect,
  onCaptionEnter,
  onCaptionLeave
}: Props): JSX.Element | null {
  const idx = findActiveCueIndex(cues, time)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const cleanupRef = useRef<(() => void) | null>(null)

  const endDrag = (): void => {
    cleanupRef.current?.()
    cleanupRef.current = null
  }

  useEffect(() => endDrag, [])

  const onMouseDown = (e: React.MouseEvent): void => {
    // 单词留给点击翻译，只有字幕条空白处可以拖动
    if ((e.target as HTMLElement).closest('.word')) return
    endDrag() // 防御：清掉可能残留的上一次拖拽
    const wv = document.querySelector<HTMLElement>('.webview')
    if (wv) wv.style.pointerEvents = 'none'
    const base = { startX: e.clientX, startY: e.clientY, baseX: offset.x, baseY: offset.y }
    const onMove = (ev: MouseEvent): void => {
      setOffset({
        x: base.baseX + ev.clientX - base.startX,
        y: base.baseY + ev.clientY - base.startY
      })
    }
    const onUp = (): void => endDrag()
    cleanupRef.current = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('mouseleave', onUp)
      if (wv) wv.style.pointerEvents = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.addEventListener('mouseleave', onUp)
    e.preventDefault()
  }

  if (hidden || idx === -1) return null
  const cue = cues[idx]
  const zhText = showZh ? (zhLines?.[idx] ?? null) : null
  const lineStyle: React.CSSProperties = {
    ...captionTextureStyle(texture, opacity),
    ...(shadow ? {} : { textShadow: 'none' })
  }
  return (
    <div
      className="caption-overlay"
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
    >
      {/* 悬停事件挂在 stack 上：英中两行之间移动不会触发 leave/enter 抖动 */}
      <div
        className="caption-stack"
        style={fontFamily ? { fontFamily } : undefined}
        onMouseEnter={onCaptionEnter}
        onMouseLeave={onCaptionLeave}
      >
        <div
          className="caption-line"
          style={{ ...lineStyle, fontSize, fontWeight: weight === 400 ? undefined : weight }}
          onMouseDown={onMouseDown}
          title="按住空白处可拖动"
        >
          <WordSpans
            text={cue.text}
            sentence={cue.text}
            knownWords={knownWords}
            onWord={(word, rect, sentence) => onWordSelect({ text: word, rect, sentence })}
          />
        </div>
        {zhText && (
          <div
            className="caption-line caption-zh"
            style={{ ...lineStyle, fontSize: zhSize }}
            onMouseDown={onMouseDown}
            title="按住空白处可拖动"
          >
            {zhText}
          </div>
        )}
      </div>
    </div>
  )
}
