import { lemmatize } from '../lemma'

/** 去掉单词首尾标点，保留字母/数字/撇号，方便词典命中 */
export function cleanWord(w: string): string {
  return w.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '')
}

interface Props {
  text: string
  sentence?: string
  /** 已加入生词本的单词词元（小写），命中即橙色高亮（不同形态按词元关联） */
  knownWords?: Set<string>
  onWord: (word: string, rect: DOMRect, sentence: string) => void
}

/** 把一句文本渲染成可点击的单词序列，空格和纯标点原样保留 */
export default function WordSpans({ text, sentence, knownWords, onWord }: Props): JSX.Element {
  const parts = text.split(/(\s+)/)
  return (
    <>
      {parts.map((part, i) => {
        if (/^\s*$/.test(part)) return <span key={i}>{part}</span>
        const word = cleanWord(part)
        if (!word) return <span key={i}>{part}</span>
        const known = knownWords?.has(lemmatize(word)) ?? false
        return (
          <span
            key={i}
            className={known ? 'word known' : 'word'}
            onClick={(e) => {
              e.stopPropagation()
              onWord(word, e.currentTarget.getBoundingClientRect(), sentence ?? text)
            }}
          >
            {part}
          </span>
        )
      })}
    </>
  )
}
