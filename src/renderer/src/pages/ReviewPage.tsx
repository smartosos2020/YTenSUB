import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { speakWord } from '../speech'
import { MASTERED_LEVEL, VocabItem } from '../../../shared/types'
import VolumeIcon from '../components/icons/VolumeIcon'

/** 到期判断：从未复习（无 due）或到期时间已过 */
function isDue(v: VocabItem, now: number): boolean {
  return v.reviewDue === undefined || v.reviewDue <= now
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * 生词复习：卡片翻转（单词 → 释义，默认显示，可用滑块开关切换显隐），
 * "认识"升一级（间隔 10分钟/1/3/7/15/30天），"不认识"回到 0 级（10 分钟后再次出现）。
 * 达到 MASTERED_LEVEL 视为已掌握。
 * 鼠标手势：按住卡片左滑 = 不认识，右滑 = 认识（拖动中禁掉文本选区）。
 */
export default function ReviewPage(): JSX.Element {
  const [queue, setQueue] = useState<VocabItem[] | null>(null)
  const [total, setTotal] = useState(0)
  const [revealed, setRevealed] = useState(true)
  // 拖拽状态：dragX 用于卡片跟手位移
  const [dragX, setDragX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const dragStartRef = useRef(0)

  useEffect(() => {
    const now = Date.now()
    void api.vocabList().then((list: VocabItem[]) => {
      const due = shuffle(list.filter((v) => isDue(v, now)))
      setQueue(due)
      setTotal(due.length)
    })
  }, [])

  if (queue === null) return <div className="page">加载中…</div>

  if (queue.length === 0) {
    return (
      <div className="page review-page">
        <h2>复习</h2>
        <div className="empty-hint">
          {total === 0 ? '今天没有到期的生词，去看看新视频吧' : '全部复习完了'}
        </div>
      </div>
    )
  }

  const item = queue[0]
  const done = total - queue.length

  /** 结算当前卡片并移出队列 */
  const grade = (known: boolean): void => {
    const level = known ? Math.min((item.reviewLevel ?? -1) + 1, MASTERED_LEVEL) : 0
    void api.vocabReview(item.id, level)
    setQueue((q) => (q ?? []).slice(1))
  }

  /** 超过该位移判定为评分滑动 */
  const GRADE_THRESHOLD = 60

  const onCardMouseDown = (e: React.MouseEvent): void => {
    if (e.button !== 0) return
    // 卡片内按钮不触发拖拽
    if ((e.target as HTMLElement).closest('button')) return
    dragStartRef.current = e.clientX
    setDragging(true)
    e.preventDefault() // 阻止拖出文本选区
    const onMove = (ev: MouseEvent): void => {
      setDragX(ev.clientX - dragStartRef.current)
    }
    const onUp = (ev: MouseEvent): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('mouseleave', onUp)
      const dx = ev.clientX - dragStartRef.current
      setDragging(false)
      setDragX(0)
      if (dx <= -GRADE_THRESHOLD) grade(false)
      else if (dx >= GRADE_THRESHOLD) grade(true)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.addEventListener('mouseleave', onUp)
  }

  const cardCls = ['review-card']
  if (dragging) cardCls.push('dragging')
  if (dragging && dragX >= GRADE_THRESHOLD) cardCls.push('drag-known')
  if (dragging && dragX <= -GRADE_THRESHOLD) cardCls.push('drag-forgot')

  return (
    <div className="page review-page">
      <h2>复习</h2>
      <div className="review-progress">
        <span>
          第 {done + 1} / {total} 张
        </span>
        <label className="review-toggle">
          <span>释义</span>
          <span className="switch" title="显示 / 隐藏释义">
            <input
              type="checkbox"
              checked={revealed}
              onChange={(e) => setRevealed(e.target.checked)}
            />
            <span className="switch-slider" />
          </span>
        </label>
      </div>
      <div className="review-center">
        <div
          className={cardCls.join(' ')}
          style={dragX ? { transform: `translateX(${dragX}px)` } : undefined}
          onMouseDown={onCardMouseDown}
        >
          <div className="review-word-row">
            <span className="review-word">{item.text}</span>
            <button className="icon-btn popup-speak" title="发音" onClick={() => speakWord(item.text)}>
              <VolumeIcon />
            </button>
          </div>
          {item.phonetic && <div className="review-phonetic">[{item.phonetic}]</div>}
          {revealed ? (
            <>
              <div className="review-translation">{item.translation}</div>
              {item.sentence && <div className="review-sentence">{item.sentence}</div>}
              <div className="review-actions">
                <button className="review-forgot" onClick={() => grade(false)}>
                  不认识
                </button>
                <button className="review-known" onClick={() => grade(true)}>
                  认识
                </button>
              </div>
            </>
          ) : (
            <button className="review-reveal" onClick={() => setRevealed(true)}>
              显示释义
            </button>
          )}
        </div>
        <div className="review-hint">按住卡片：左滑不认识 · 右滑认识</div>
      </div>
    </div>
  )
}
