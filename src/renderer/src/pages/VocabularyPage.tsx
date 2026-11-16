import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { speakWord } from '../speech'
import { MASTERED_LEVEL, VocabItem } from '../../../shared/types'
import TrashIcon from '../components/icons/TrashIcon'
import VolumeIcon from '../components/icons/VolumeIcon'
import PageShell from '../components/PageShell'
import type { VocabVisualResult } from '../../../shared/vocab-visual'

function isMastered(v: VocabItem): boolean {
  return v.reviewLevel !== undefined && v.reviewLevel >= MASTERED_LEVEL
}

function visualSourceLabel(source: VocabVisualResult['source']): string {
  if (source === 'noto') return 'Noto Emoji'
  if (source === 'openverse') return 'Openverse'
  return 'Wikimedia Commons'
}

/** 只给进入视口的卡片取图，避免打开大生词本时瞬间发起大量请求。 */
function VocabVisualThumb({ item, enabled }: { item: VocabItem; enabled: boolean }): JSX.Element | null {
  const hostRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [visual, setVisual] = useState<VocabVisualResult | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!enabled) return
    const node = hostRef.current
    if (!node || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '180px' }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [enabled])

  const load = useCallback((refresh = false): void => {
    setLoading(true)
    void api
      .vocabVisualGet(
        { text: item.text, translation: item.translation, sentence: item.sentence },
        refresh
      )
      .then(setVisual)
      .finally(() => setLoading(false))
  }, [item.text, item.translation, item.sentence])

  useEffect(() => {
    if (enabled && visible) load(false)
  }, [enabled, visible, load])

  if (!enabled) return null
  return (
    <div ref={hostRef} className="vocab-visual">
      {!visible || loading ? (
        <div className="vocab-visual-state">{visible ? '正在匹配图片…' : '等待加载…'}</div>
      ) : visual?.imageDataUrl ? (
        <img src={visual.imageDataUrl} alt={`${item.text} 的图片释义`} draggable={false} />
      ) : visual?.emoji ? (
        <div className="vocab-visual-emoji" role="img" aria-label={visual.alt}>{visual.emoji}</div>
      ) : (
        <div className="vocab-visual-state vocab-visual-empty">
          <span>暂无可靠配图</span>
          <button type="button" onClick={() => load(true)}>重新匹配</button>
        </div>
      )}
      {visual && !loading && (
        <div className="vocab-visual-meta">
          <button
            type="button"
            disabled={!visual.sourceUrl}
            title={visual.sourceUrl ? '打开图片来源页' : undefined}
            onClick={() => visual.sourceUrl && void api.openExternal(visual.sourceUrl)}
          >
            {visual.creator || visualSourceLabel(visual.source)}
            {visual.license ? ` · ${visual.license}` : ''}
          </button>
          <button type="button" onClick={() => load(true)}>换一张</button>
        </div>
      )}
    </div>
  )
}

/** 导出 CSV（Excel / Anki 均可导入） */
function toCsv(items: VocabItem[]): string {
  const esc = (s: string | number | undefined): string => {
    const v = String(s ?? '')
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v
  }
  const rows = items.map((v) =>
    [v.text, v.phonetic ?? '', v.translation, v.sentence, v.videoTitle, v.timestamp,
      new Date(v.addedAt).toISOString()]
      .map(esc)
      .join(',')
  )
  return 'word,phonetic,translation,sentence,video,timestamp,addedAt\n' + rows.join('\n')
}

export default function VocabularyPage(): JSX.Element {
  const navigate = useNavigate()
  const [vocab, setVocab] = useState<VocabItem[]>([])
  const [groupByVideo, setGroupByVideo] = useState(true)
  const [imagesEnabled, setImagesEnabled] = useState(true)

  const reload = useCallback(async (): Promise<void> => {
    setVocab(await api.vocabList())
  }, [])

  useEffect(() => {
    void reload()
    void api.settingsGet().then((settings) => setImagesEnabled(settings.reviewImages !== false))
  }, [reload])

  const remove = async (id: string): Promise<void> => {
    await api.vocabRemove(id)
    void reload()
  }

  const groups = groupByVideo
    ? vocab.reduce<Record<string, VocabItem[]>>((acc, item) => {
        const key = item.videoTitle || item.videoId
        ;(acc[key] ??= []).push(item)
        return acc
      }, {})
    : { 全部: vocab }

  return (
    <PageShell
      title={`生词本（${vocab.length}）`}
      desc="收藏的生词与例句，支持 CSV 导出与间隔重复复习"
      descActions={
        <>
          <label>
            <input
              type="checkbox"
              checked={groupByVideo}
              onChange={(e) => setGroupByVideo(e.target.checked)}
            />
            按来源视频分组
          </label>
          <button
            disabled={vocab.length === 0}
            title="导出为 CSV（Excel / Anki 可导入）"
            onClick={() =>
              void api.saveTextFile({
                defaultName: 'ytensub-vocab.csv',
                content: toCsv(vocab),
                filterName: 'CSV',
                ext: 'csv'
              })
            }
          >
            导出
          </button>
          <button onClick={() => navigate('/review')}>去复习</button>
        </>
      }
    >
      {vocab.length === 0 && (
        <div className="empty-hint">在浏览页字幕里选中单词，就能加入生词本</div>
      )}
      {Object.entries(groups).map(([group, items]) => (
        <div key={group} className="vocab-group">
          <h3>{group}</h3>
          <div className="vocab-grid">
            {items.map((item) => (
              <div key={item.id} className="vocab-item">
                <VocabVisualThumb item={item} enabled={imagesEnabled} />
                <div className="vocab-head">
                  <span className="vocab-text">{item.text}</span>
                  <button
                    className="vocab-speak icon-btn"
                    title="发音"
                    onClick={() => speakWord(item.text)}
                  >
                    <VolumeIcon />
                  </button>
                  {isMastered(item) && <span className="vocab-mastered">已掌握</span>}
                  <button
                    className="vocab-remove icon-btn"
                    title="删除"
                    onClick={() => void remove(item.id)}
                  >
                    <TrashIcon />
                  </button>
                </div>
                {item.phonetic && <div className="vocab-phonetic">[{item.phonetic}]</div>}
                <div className="vocab-translation">{item.translation}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </PageShell>
  )
}
