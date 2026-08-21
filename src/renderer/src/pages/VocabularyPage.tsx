import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { VocabItem } from '../../../shared/types'
import TrashIcon from '../components/icons/TrashIcon'

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function VocabularyPage(): JSX.Element {
  const navigate = useNavigate()
  const [vocab, setVocab] = useState<VocabItem[]>([])
  const [groupByVideo, setGroupByVideo] = useState(true)

  const reload = useCallback(async (): Promise<void> => {
    setVocab(await api.vocabList())
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const remove = async (id: string): Promise<void> => {
    await api.vocabRemove(id)
    void reload()
  }

  const openSource = (item: VocabItem): void => {
    navigate(`/browse?v=${encodeURIComponent(item.videoId)}&t=${item.timestamp}`)
  }

  const groups = groupByVideo
    ? vocab.reduce<Record<string, VocabItem[]>>((acc, item) => {
        const key = item.videoTitle || item.videoId
        ;(acc[key] ??= []).push(item)
        return acc
      }, {})
    : { 全部: vocab }

  return (
    <div className="page vocab-page">
      <div className="vocab-toolbar">
        <h2>生词本（{vocab.length}）</h2>
        <label>
          <input
            type="checkbox"
            checked={groupByVideo}
            onChange={(e) => setGroupByVideo(e.target.checked)}
          />
          按来源视频分组
        </label>
      </div>
      {vocab.length === 0 && (
        <div className="empty-hint">在浏览页字幕里选中单词，就能加入生词本</div>
      )}
      {Object.entries(groups).map(([group, items]) => (
        <div key={group} className="vocab-group">
          <h3>{group}</h3>
          {items.map((item) => (
            <div key={item.id} className="vocab-item">
              <div className="vocab-head">
                <span className="vocab-text">{item.text}</span>
                {item.phonetic && <span className="vocab-phonetic">[{item.phonetic}]</span>}
                <span className="vocab-translation">{item.translation}</span>
                <button
                  className="vocab-remove icon-btn"
                  title="删除"
                  onClick={() => void remove(item.id)}
                >
                  <TrashIcon />
                </button>
              </div>
              {item.sentence && <div className="vocab-sentence">{item.sentence}</div>}
              <button className="vocab-source" onClick={() => openSource(item)}>
                来源：{item.videoTitle || item.videoId} @{formatTime(item.timestamp)}
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
