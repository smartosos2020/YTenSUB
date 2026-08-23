import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { speakWord } from '../speech'
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
  const ref = useRef<HTMLDivElement | null>(null)

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

  const add = async (): Promise<void> => {
    if (!result || result === 'loading') return
    await api.vocabAdd({
      text,
      translation: result.translation,
      phonetic: result.phonetic,
      videoId: video.videoId,
      videoTitle: video.title,
      timestamp: Math.floor(time),
      sentence
    })
    setSaved(true)
    setTimeout(onClose, 1200)
  }

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
          <div className="popup-footer">
            <span className="popup-source">{SOURCE_LABEL[result.source]}</span>
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
