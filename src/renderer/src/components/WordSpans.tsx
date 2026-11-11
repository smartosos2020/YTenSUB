import { lemmatize } from '../lemma'
import { useEffect, useRef } from 'react'

/** 去掉单词首尾标点，保留字母/数字/撇号，方便词典命中 */
export function cleanWord(w: string): string {
  return w.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '')
}

interface Props {
  text: string
  sentence?: string
  /** 已加入生词本的单词词元（小写），命中即橙色高亮（不同形态按词元关联） */
  knownWords?: Set<string>
  savedTranslations?: ReadonlyMap<string, string>
  onWord: (word: string, rect: DOMRect, sentence: string) => void
  /** 悬停取词：悬停 300ms 后触发（扫过不触发） */
  onWordHover?: (word: string, rect: DOMRect, sentence: string) => void
}

/** 把一句文本渲染成可点击的单词序列，空格和纯标点原样保留 */
export default function WordSpans({ text, sentence, knownWords, savedTranslations, onWord, onWordHover }: Props): JSX.Element {
  // 悬停防抖：同一单词停留 300ms 才触发，移到别处即取消
  const hoverTimerRef = useRef<number | null>(null)
  const cancelHover = (): void => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
  }
  useEffect(() => cancelHover, [])

  const parts = text.split(/(\s+)/)
  return (
    <>
      {parts.map((part, i) => {
        if (/^\s*$/.test(part)) return <span key={i}>{part}</span>
        const word = cleanWord(part)
        if (!word) return <span key={i}>{part}</span>
        const lemma = lemmatize(word)
        const known = knownWords?.has(lemma) ?? false
        const translation = savedTranslations?.get(lemma)
        const wordEnd = part.indexOf(word) + word.length
        return (
          <span
            key={i}
            className={known ? 'word known' : 'word'}
            onClick={(e) => {
              e.stopPropagation()
              cancelHover()
              onWord(word, e.currentTarget.getBoundingClientRect(), sentence ?? text)
            }}
            onMouseEnter={
              onWordHover
                ? (e) => {
                    cancelHover()
                    const el = e.currentTarget
                    const rect = el.getBoundingClientRect()
                    hoverTimerRef.current = window.setTimeout(() => {
                      if (!el.isConnected) return // 词已卸载（字幕滚动走）不再弹翻译
                      onWordHover(word, rect, sentence ?? text)
                    }, 300)
                  }
                : undefined
            }
            onMouseLeave={onWordHover ? cancelHover : undefined}
          >
            {part.slice(0, wordEnd)}{translation && `[${translation}]`}{part.slice(wordEnd)}
          </span>
        )
      })}
    </>
  )
}
