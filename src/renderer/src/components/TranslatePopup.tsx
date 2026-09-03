import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { speakWord } from '../speech'
import { lemmatize } from '../lemma'
import { TranslateResult, VocabItem } from '../../../shared/types'
import TrashIcon from './icons/TrashIcon'
import VolumeIcon from './icons/VolumeIcon'
import CopyIcon from './icons/CopyIcon'

export interface PopupVideoInfo {
  videoId: string
  title: string
}

interface Props {
  text: string
  rect: DOMRect
  sentence: string
  video: PopupVideoInfo
  time: number
  /** 文本已在生词本中时传入对应条目，底部按钮变为"删除生词" */
  savedItem: VocabItem | null
  onClose: () => void
}

const SOURCE_LABEL: Record<string, string> = {
  local: '本地词典',
  google: 'Google',
  llm: 'LLM'
}

export default function TranslatePopup({
  text,
  rect,
  sentence,
  video,
  time,
  savedItem,
  onClose
}: Props): JSX.Element {
  const [result, setResult] = useState<TranslateResult | null | 'loading'>('loading')
  const [saved, setSaved] = useState(false)
  const [removed, setRemoved] = useState(false)
  const [copied, setCopied] = useState(false)
  // 语境释义（按需触发，省 token）：LLM 启用且有所在句子时显示入口
  const [ctxTrans, setCtxTrans] = useState<string | 'loading' | null>(null)
  const [llmOn, setLlmOn] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    api
      .settingsGet()
      .then((s) => setLlmOn((s.enabledTranslators ?? []).includes('llm')))
      .catch(() => {})
  }, [])

  const askContext = (): void => {
    if (ctxTrans) return
    setCtxTrans('loading')
    void api
      .translateContext(text, sentence)
      .then((r) => setCtxTrans(r ?? null))
      .catch(() => setCtxTrans(null))
  }

  useEffect(() => {
    let alive = true
    api
      .translate(text)
      .then((r) => alive && setResult(r))
      .catch(() => alive && setResult(null))
    return () => {
      alive = false
    }
  }, [text])

  // 设置项：打开弹窗自动朗读发音
  useEffect(() => {
    api
      .settingsGet()
      .then((s) => {
        if (s.autoSpeakOnLookup) speakWord(text)
      })
      .catch(() => {})
  }, [text])

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent): void => {
      if (ref.current && ref.current.contains(e.target as Node)) return
      // 点了另一个单词：由新弹窗接管，不走关闭（避免视频播放/暂停抖动）
      if ((e.target as HTMLElement).closest?.('.word')) return
      onClose()
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [onClose])

  const add = useCallback(async (): Promise<void> => {
    if (!result || result === 'loading') return
    // 统一存词元：running/ran 都归并到 run，高亮与复习按词元关联
    await api.vocabAdd({
      text: lemmatize(text),
      translation: result.translation,
      phonetic: result.phonetic,
      videoId: video.videoId,
      videoTitle: video.title,
      timestamp: Math.floor(time),
      sentence
    })
    setSaved(true)
    setTimeout(onClose, 1200)
  }, [result, text, video.videoId, video.title, time, sentence, onClose])

  // 设置项：翻译成功且未收藏时自动加入生词本
  useEffect(() => {
    if (!result || result === 'loading' || savedItem || saved) return
    api
      .settingsGet()
      .then((s) => {
        if (s.autoCollectWord) void add()
      })
      .catch(() => {})
  }, [result, savedItem, saved, add])

  const remove = async (): Promise<void> => {
    if (!savedItem) return
    await api.vocabRemove(savedItem.id)
    setRemoved(true)
    setTimeout(onClose, 1200)
  }

  const copyTranslation = (): void => {
    if (!result || result === 'loading') return
    void navigator.clipboard.writeText(result.translation).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    })
  }

  const top = Math.min(rect.bottom + 8, window.innerHeight - 220)
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - 360)

  return (
    <div ref={ref} className="translate-popup" style={{ top, left }}>
      <button className="popup-close" onClick={onClose} aria-label="关闭">
        ×
      </button>
      <div className="popup-word-row">
        <div className="popup-word">{text}</div>
        <button className="icon-btn popup-speak" title="发音" onClick={() => speakWord(text)}>
          <VolumeIcon />
        </button>
      </div>
      {result === 'loading' && <div className="popup-translation">翻译中…</div>}
      {result === null && <div className="popup-translation error">翻译失败</div>}
      {result && result !== 'loading' && (
        <>
          {result.phonetic && <div className="popup-phonetic">[{result.phonetic}]</div>}
          <div className="popup-translation">{result.translation}</div>
          {ctxTrans === 'loading' && <div className="popup-context">语境释义查询中…</div>}
          {ctxTrans && ctxTrans !== 'loading' && (
            <div className="popup-context">语境：{ctxTrans}</div>
          )}
          <div className="popup-footer">
            <span className="popup-source">
              {SOURCE_LABEL[result.source]}
              {llmOn && sentence && !ctxTrans && (
                <button className="popup-ctx-btn" title="结合整句语境，由 LLM 给出该词在此处的释义" onClick={askContext}>
                  语境释义
                </button>
              )}
            </span>
            <span className="popup-footer-actions">
              <button className="popup-copy" title="复制释义" onClick={copyTranslation}>
                {copied ? '✓' : <CopyIcon />}
              </button>
              {saved ? (
                <span className="popup-saved">已加入生词本</span>
              ) : removed ? (
                <span className="popup-saved">已从生词本删除</span>
              ) : savedItem ? (
                <button className="danger icon-btn" title="删除生词" onClick={remove}>
                  <TrashIcon />
                </button>
              ) : (
                <button onClick={add}>加入生词本</button>
              )}
            </span>
          </div>
        </>
      )}
    </div>
  )
}
