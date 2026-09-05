import { memo, useCallback, useEffect, useRef } from 'react'
import { Cue, findActiveCueIndex } from '../../../shared/captions'
import WordSpans from './WordSpans'
import RepeatIcon from './icons/RepeatIcon'
import DownloadIcon from './icons/DownloadIcon'

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
  /** 悬停取词（悬停 300ms 弹出翻译，设置页开关控制） */
  onWordHover?: (sel: WordSelection) => void
  /** 是否显示中文字幕（开关状态，默认关） */
  showZh: boolean
  /** 与 cues 等长对齐的中文字幕；null 表示尚未就绪 */
  zhLines: (string | null)[] | null
  /** 正在批量翻译中（无自带中文字幕时的回退翻译） */
  zhLoading: boolean
  onShowZhChange: (v: boolean) => void
  /** 已加入生词本的单词（小写），字幕中橙色高亮 */
  knownWords: Set<string>
  /** 单句循环 */
  looping: boolean
  onLoopChange: (v: boolean) => void
  /** 中文轨时间微调（仅存在原生中文轨时展示） */
  hasZhNative: boolean
  zhOffset: number
  onZhOffset: (delta: number) => void
  /** 导出双语字幕 */
  onExport: () => void
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
  onWordHover?: (text: string, rect: DOMRect, sentence: string) => void
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
  onWord,
  onWordHover
}: RowProps): JSX.Element {
  const handleClick = (): void => {
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed) return // 拖选时不触发跳转
    onSeek(cue.start)
  }

  return (
    <div data-cue-idx={idx} className={'cue' + (active ? ' active' : '')} onClick={handleClick}>
      <div className="cue-en">
        <WordSpans text={cue.text} knownWords={knownWords} onWord={onWord} onWordHover={onWordHover} />
      </div>
      {showZh && zh && <div className="cue-zh">{zh}</div>}
    </div>
  )
})

/** 列表顶部工具条：中文字幕开关 / 中文轨时间微调 / 单句循环 / 导出字幕 */
function ZhToolbar({
  showZh,
  disabled,
  loading,
  onChange,
  looping,
  onLoopChange,
  hasZhNative,
  zhOffset,
  onZhOffset,
  onExport
}: {
  showZh: boolean
  disabled: boolean
  loading: boolean
  onChange: (v: boolean) => void
  looping: boolean
  onLoopChange: (v: boolean) => void
  hasZhNative: boolean
  zhOffset: number
  onZhOffset: (delta: number) => void
  onExport: () => void
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
      <span className="subs-toolbar-spacer" />
      {showZh && hasZhNative && (
        <span className="zh-offset" title="中文字幕时间微调">
          <button className="zh-offset-btn" onClick={() => onZhOffset(-0.5)}>
            -
          </button>
          <span className="zh-offset-value">
            {zhOffset > 0 ? '+' : ''}
            {zhOffset.toFixed(1)}s
          </span>
          <button className="zh-offset-btn" onClick={() => onZhOffset(0.5)}>
            +
          </button>
        </span>
      )}
      <button
        className={looping ? 'icon-btn looping' : 'icon-btn'}
        title={looping ? '关闭单句循环' : '单句循环当前字幕'}
        onClick={() => onLoopChange(!looping)}
      >
        <RepeatIcon />
      </button>
      <button className="icon-btn" title="导出双语字幕（SRT）" disabled={disabled} onClick={onExport}>
        <DownloadIcon />
      </button>
    </div>
  )
}

export default function SubtitlePanel({
  cues,
  time,
  hasCaptions,
  onSeek,
  onWordSelect,
  onWordHover,
  showZh,
  zhLines,
  zhLoading,
  onShowZhChange,
  knownWords,
  looping,
  onLoopChange,
  hasZhNative,
  zhOffset,
  onZhOffset,
  onExport
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
  const handleWordHover = useCallback(
    (text: string, rect: DOMRect, sentence: string) => onWordHover?.({ text, rect, sentence }),
    [onWordHover]
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
        looping={looping}
        onLoopChange={onLoopChange}
        hasZhNative={hasZhNative}
        zhOffset={zhOffset}
        onZhOffset={onZhOffset}
        onExport={onExport}
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
                onWordHover={onWordHover ? handleWordHover : undefined}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
