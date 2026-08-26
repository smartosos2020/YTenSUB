import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { speakWord } from '../speech'
import { MASTERED_LEVEL, VocabItem } from '../../../shared/types'
import TrashIcon from '../components/icons/TrashIcon'
import VolumeIcon from '../components/icons/VolumeIcon'

function isMastered(v: VocabItem): boolean {
  return v.reviewLevel !== undefined && v.reviewLevel >= MASTERED_LEVEL
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

  const groups = groupByVideo
    ? vocab.reduce<Record<string, VocabItem[]>>((acc, item) => {
        const key = item.videoTitle || item.videoId
        ;(acc[key] ??= []).push(item)
        return acc
      }, {})
    : { 全部: vocab }

  return (
    <div className="page vocab-page">
      <div className="page-head">
        <div className="page-head-row">
          <h2>生词本（{vocab.length}）</h2>
          <div className="page-head-actions">
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
          </div>
        </div>
        <div className="page-desc">收藏的生词与例句，支持 CSV 导出与间隔重复复习</div>
      </div>
      {vocab.length === 0 && (
        <div className="empty-hint">在浏览页字幕里选中单词，就能加入生词本</div>
      )}
      {Object.entries(groups).map(([group, items]) => (
        <div key={group} className="vocab-group">
          <h3>{group}</h3>
          <div className="vocab-grid">
            {items.map((item) => (
              <div key={item.id} className="vocab-item">
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
    </div>
  )
}
