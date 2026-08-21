import { memo, useCallback, useEffect, useRef } from 'react'
import { Cue, findActiveCueIndex } from '../../../shared/captions'
import WordSpans from './WordSpans'

export interface WordSelection {
  text: string
  rect: DOMRect
  sentence: string
}

interface Props {
  cues: Cue[]
  time: number
  hasCaptions: boolean
  onSeek: (t: number) => void
  onWordSelect: (sel: WordSelection) => void
  /** 是否显示中文字幕（开关状态，默认关） */
  showZh: boolean
  /** 与 cues 等长对齐的中文字幕；null 表示尚未就绪 */
  zhLines: (string | null)[] | null
  /** 正在批量翻译中（无自带中文字幕时的回退翻译） */
  zhLoading: boolean
  onShowZhChange: (v: boolean) => void
  /** 已加入生词本的单词（小写），字幕中橙色高亮 */
  knownWords: Set<string>
}

interface RowProps {
  cue: Cue
  idx: number
  active: boolean
  showZh: boolean
  zh: string | null
  knownWords: Set<string>
  onSeek: (t: number) => void
  onWord: (text: string, rect: DOMRect, sentence: string) => void
}

/** 单行字幕：memo 化，播放进度刷新时只有高亮变化的行重渲染 */
const CueRow = memo(function CueRow({
  cue,
  idx,
  active,
  showZh,
  zh,
  knownWords,
  onSeek,
  onWord
}: RowProps): JSX.Element {
  const handleClick = (): void => {
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed) return // 拖选时不触发跳转
    onSeek(cue.start)
  }

  return (
    <div data-cue-idx={idx} className={'cue' + (active ? ' active' : '')} onClick={handleClick}>
      <div className="cue-en">
        <WordSpans text={cue.text} knownWords={knownWords} onWord={onWord} />
      </div>
      {showZh && zh && <div className="cue-zh">{zh}</div>}
    </div>
  )
})

/** 列表顶部的中文字幕滑动开关 */
function ZhToolbar({
  showZh,
  disabled,
  loading,
  onChange
}: {
  showZh: boolean
  disabled: boolean
  loading: boolean
  onChange: (v: boolean) => void
}): JSX.Element {
  return (
    <div className="subs-toolbar">
      <span className="subs-toolbar-label">中文字幕</span>
      <label className="switch" title={disabled ? '打开一个带字幕的视频后可用' : '显示 / 隐藏中文字幕'}>
        <input
          type="checkbox"
          checked={showZh}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="switch-slider" />
      </label>
      {loading && <span className="subs-toolbar-status">翻译中…</span>}
    </div>
  )
}

export default function SubtitlePanel({
  cues,
  time,
  hasCaptions,
  onSeek,
  onWordSelect,
  showZh,
  zhLines,
  zhLoading,
  onShowZhChange,
  knownWords
}: Props): JSX.Element {
  const activeIdx = findActiveCueIndex(cues, time)
  const activeRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeIdx])

  // 单词点击回调必须引用稳定（useCallback），否则每次渲染都是新函数，
  // CueRow 的 memo 会失效，导致播放进度刷新（每 300ms）时全列表重渲染
  const handleWord = useCallback(
    (text: string, rect: DOMRect, sentence: string) => onWordSelect({ text, rect, sentence }),
    [onWordSelect]
  )

  // 拖选短语（可跨单词）：mouseup 时取选区文本
  const handleMouseUp = (): void => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) return
    const text = sel.toString().trim()
    if (!text) return
    const rect = sel.getRangeAt(0).getBoundingClientRect()
    let el: Node | null = sel.anchorNode
    while (el && !(el instanceof HTMLElement && el.dataset.cueIdx !== undefined)) {
      el = el.parentNode
    }
    // 所在句只取英文行，避免中文字幕混入划词翻译的语境
    const sentence =
      el instanceof HTMLElement
        ? (el.querySelector('.cue-en')?.textContent ?? el.textContent ?? '').trim()
        : ''
    onWordSelect({ text, rect, sentence })
  }

  return (
    <div className="subs-wrap">
      <ZhToolbar
        showZh={showZh}
        disabled={cues.length === 0}
        loading={zhLoading}
        onChange={onShowZhChange}
      />
      {cues.length === 0 ? (
        <div className="subtitle-panel empty">
          {hasCaptions ? '打开一个视频，字幕会显示在这里' : '该视频没有英文字幕'}
        </div>
      ) : (
        <div className="subtitle-panel" onMouseUp={handleMouseUp}>
          {cues.map((cue, i) => (
            <div key={i} ref={i === activeIdx ? activeRef : undefined}>
              <CueRow
                cue={cue}
                idx={i}
                active={i === activeIdx}
                showZh={showZh}
                zh={showZh ? (zhLines?.[i] ?? null) : null}
                knownWords={knownWords}
                onSeek={onSeek}
                onWord={handleWord}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
