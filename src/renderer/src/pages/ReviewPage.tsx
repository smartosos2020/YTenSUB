import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { speakWord } from '../speech'
import { MASTERED_LEVEL, VocabItem } from '../../../shared/types'
import VolumeIcon from '../components/icons/VolumeIcon'
import PageShell from '../components/PageShell'
import type { VocabVisualResult } from '../../../shared/vocab-visual'

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

function visualSourceLabel(source: VocabVisualResult['source']): string {
  if (source === 'noto') return 'Noto Emoji'
  if (source === 'openverse') return 'Openverse'
  return 'Wikimedia Commons'
}

/**
 * 生词复习：释义显隐切换（默认显示，可用右上角开关隐藏，隐藏时可点"显示释义"翻开），
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
  const [imagesEnabled, setImagesEnabled] = useState(true)
  const [visual, setVisual] = useState<VocabVisualResult | null>(null)
  const [visualLoading, setVisualLoading] = useState(false)

  useEffect(() => {
    const now = Date.now()
    void api.vocabList().then((list: VocabItem[]) => {
      const due = shuffle(list.filter((v) => isDue(v, now)))
      setQueue(due)
      setTotal(due.length)
    })
  }, [])

  useEffect(() => {
    void api.settingsGet().then((settings) => setImagesEnabled(settings.reviewImages !== false))
  }, [])

  const item = queue?.[0] ?? null
  const visualItemId = item?.id
  const visualText = item?.text ?? ''
  const visualTranslation = item?.translation ?? ''
  const visualSentence = item?.sentence ?? ''

  useEffect(() => {
    let active = true
    setVisual(null)
    if (!visualItemId || !imagesEnabled) {
      setVisualLoading(false)
      return () => {
        active = false
      }
    }
    setVisualLoading(true)
    void api
      .vocabVisualGet({ text: visualText, translation: visualTranslation, sentence: visualSentence })
      .then((result) => {
        if (active) setVisual(result)
      })
      .finally(() => {
        if (active) setVisualLoading(false)
      })
    return () => {
      active = false
    }
  }, [visualItemId, visualText, visualTranslation, visualSentence, imagesEnabled])

  if (queue === null) return <div className="page">加载中…</div>

  if (queue.length === 0) {
    return (
      <PageShell title="复习" desc="间隔重复记忆卡片：按住卡片左滑不认识，右滑认识">
        <div className="empty-hint">
          {total === 0 ? '今天没有到期的生词，去看看新视频吧' : '全部复习完了'}
        </div>
      </PageShell>
    )
  }

  if (!item) return <div className="page">加载中…</div>
  const done = total - queue.length

  const refreshVisual = (): void => {
    setVisualLoading(true)
    void api
      .vocabVisualGet(
        { text: item.text, translation: item.translation, sentence: item.sentence },
        true
      )
      .then(setVisual)
      .finally(() => setVisualLoading(false))
  }

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
    <PageShell
      title="复习"
      desc={`间隔重复记忆卡片：按住卡片左滑不认识，右滑认识（第 ${done + 1} / ${total} 张）`}
      descActions={
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
      }
    >
      <div className="review-center">
        <div
          className={cardCls.join(' ')}
          style={dragX ? { transform: `translateX(${dragX}px)` } : undefined}
          onMouseDown={onCardMouseDown}
        >
          {imagesEnabled && (revealed || (item.reviewLevel ?? 0) <= 1) && (
            <div className="review-visual" aria-live="polite">
              {visualLoading ? (
                <div className="review-visual-loading">正在匹配图片释义…</div>
              ) : visual ? (
                <>
                  {visual.imageDataUrl ? (
                    <img src={visual.imageDataUrl} alt={`${item.text} 的图片释义`} draggable={false} />
                  ) : visual.emoji ? (
                    <div className="review-visual-emoji" role="img" aria-label={visual.alt}>
                      {visual.emoji}
                    </div>
                  ) : null}
                  <div className="review-visual-meta">
                    {visual.sourceUrl ? (
                      <button
                        type="button"
                        className="review-visual-source"
                        onClick={() => void api.openExternal(visual.sourceUrl!)}
                        title="打开图片来源页"
                      >
                        {visual.creator || visualSourceLabel(visual.source)}
                        {visual.license ? ` · ${visual.license}` : ''}
                      </button>
                    ) : (
                      <span>{visualSourceLabel(visual.source)}</span>
                    )}
                    <button type="button" onClick={refreshVisual} disabled={visualLoading}>
                      换一张
                    </button>
                  </div>
                </>
              ) : (
                <div className="review-visual-empty">
                  <span>暂无可靠配图</span>
                  <button type="button" onClick={refreshVisual}>重新匹配</button>
                </div>
              )}
            </div>
          )}
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
    </PageShell>
  )
}
