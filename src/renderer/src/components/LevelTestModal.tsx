import { useState } from 'react'
import { Button } from '@mantine/core'
import { CefrLevel } from '../../../shared/types'
import { LEVEL_TEST_WORDS, LevelAnswer, estimateLevelFromAnswers } from '../../../shared/level-test'
import CloseIcon from './icons/CloseIcon'

interface Props {
  /** 应用到精选推荐（写 settings.curatedLevel，调用方决定是否上云） */
  onApply: (level: CefrLevel) => void
  onClose: () => void
}

/**
 * 词汇量定级向导（⑩）：24 个词逐词标记"认识/不认识"，估出 CEFR 等级。
 * 粗粒度定位"推荐起点"而非测评（估级规则见 shared/level-test.ts）。
 */
export default function LevelTestModal({ onApply, onClose }: Props): JSX.Element {
  const [idx, setIdx] = useState(0)
  const [answers, setAnswers] = useState<LevelAnswer[]>([])
  const total = LEVEL_TEST_WORDS.length
  const done = idx >= total
  // 答满 24 题必然出结果（不足一半才返回 null，这里不会发生）；保留 null 守卫对齐类型
  const result = done ? estimateLevelFromAnswers(answers) : null

  const answer = (known: boolean): void => {
    setAnswers((a) => [...a, { w: LEVEL_TEST_WORDS[idx].w, known }])
    setIdx((i) => i + 1)
  }

  const restart = (): void => {
    setIdx(0)
    setAnswers([])
  }

  return (
    <div className="paywall-overlay" onClick={onClose}>
      <div className="paywall-card lt-card" onClick={(e) => e.stopPropagation()}>
        <button className="paywall-close" title="关闭" onClick={onClose}>
          <CloseIcon />
        </button>
        {!done ? (
          <>
            <div className="lt-progress">
              {idx + 1}/{total} · 认识这个词吗？
            </div>
            <div className="lt-word">{LEVEL_TEST_WORDS[idx].w}</div>
            <div className="lt-actions">
              <Button variant="light" onClick={() => answer(true)}>
                认识
              </Button>
              <Button variant="default" onClick={() => answer(false)}>
                不认识
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="lt-result">{result ? `你的水平约为 ${result}` : '答题太少，无法估计'}</div>
            <div className="lt-result-sub">等级用于精选推荐的难度贴合，之后可随时重测</div>
            <div className="lt-actions">
              {result && <Button onClick={() => onApply(result)}>应用到精选推荐</Button>}
              <Button variant="default" onClick={restart}>
                重新测
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
