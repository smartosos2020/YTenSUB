import { useState } from 'react'
import { api } from '../api'
import { CEFR_LEVELS, CefrLevel, FAV_TAG_PRESETS, Favorite, Folder } from '../../../shared/types'

interface Props {
  fav: Favorite
  folders: Folder[]
  onClose: () => void
  /** 保存后由父组件刷新列表 */
  onSaved: () => void
}

/** 编辑收藏：分类 + 难度（CEFR，可重新估算）+ 内容标签（预设/自定义，多选） */
export default function EditFavModal({ fav, folders, onClose, onSaved }: Props): JSX.Element {
  const [folderId, setFolderId] = useState<string | null>(fav.folderId)
  const [level, setLevel] = useState<CefrLevel | ''>(fav.level ?? '')
  const [tags, setTags] = useState<string[]>(fav.tags ?? [])
  const [newTag, setNewTag] = useState('')
  const [newFolder, setNewFolder] = useState('')
  const [estimating, setEstimating] = useState(false)
  const [estMsg, setEstMsg] = useState('')

  const toggleTag = (t: string): void =>
    setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))

  const addCustomTag = (): void => {
    const t = newTag.trim()
    if (!t || tags.includes(t)) return
    setTags([...tags, t])
    setNewTag('')
  }

  const reEstimate = async (): Promise<void> => {
    setEstimating(true)
    setEstMsg('')
    try {
      const lv = await api.favEstimateLevel(fav.videoId)
      if (lv && CEFR_LEVELS.includes(lv as CefrLevel)) {
        setLevel(lv as CefrLevel)
        setEstMsg('已重新估算（手动保存后生效；手动选定的等级不会被自动估值覆盖）')
      } else {
        setEstMsg('估算失败：该视频没有可用字幕（或 LLM 未配置）')
      }
    } finally {
      setEstimating(false)
    }
  }

  const save = async (): Promise<void> => {
    const manualLevel = level !== (fav.level ?? '')
    await api.favUpdateMeta(fav.videoId, {
      level: level === '' ? null : level,
      // 手动改过难度 → 标记为手动；没改则沿用原标记（估值仍可更新）
      levelAuto: manualLevel ? false : fav.levelAuto,
      tags
    })
    if (folderId !== fav.folderId) await api.favMove(fav.videoId, folderId)
    onSaved()
    onClose()
  }

  const customTags = tags.filter((t) => !FAV_TAG_PRESETS.includes(t))

  return (
    <div className="regen-overlay" onClick={onClose}>
      <div className="regen-card" onClick={(e) => e.stopPropagation()}>
        <div className="regen-title">编辑收藏</div>
        <div className="regen-desc" title={fav.title}>
          {fav.title || fav.videoId}
        </div>

        <div className="field-label">难度（CEFR）</div>
        <div className="seg-tabs level-seg">
          <button className={level === '' ? 'selected' : ''} onClick={() => setLevel('')}>
            未评估
          </button>
          {CEFR_LEVELS.map((l) => (
            <button key={l} className={level === l ? 'selected' : ''} onClick={() => setLevel(l)}>
              {l}
            </button>
          ))}
        </div>
        <div className="level-row">
          {fav.levelAuto && fav.level && (
            <span className="level-auto-hint">当前为自动估值（{fav.level}）</span>
          )}
          <button className="icon-btn" disabled={estimating} onClick={() => void reEstimate()}>
            {estimating ? '估算中…' : '重新估算'}
          </button>
        </div>
        {estMsg && <div className="level-auto-hint">{estMsg}</div>}

        <div className="field-label">内容标签</div>
        <div className="tag-chips">
          {FAV_TAG_PRESETS.map((t) => (
            <button
              key={t}
              className={tags.includes(t) ? 'tag-chip selected' : 'tag-chip'}
              onClick={() => toggleTag(t)}
            >
              {t}
            </button>
          ))}
          {customTags.map((t) => (
            <button
              key={t}
              className="tag-chip selected"
              title="点击移除自定义标签"
              onClick={() => toggleTag(t)}
            >
              {t} ×
            </button>
          ))}
          <span className="tag-new">
            <input
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addCustomTag()}
              placeholder="自定义标签…"
            />
            <button disabled={!newTag.trim()} onClick={addCustomTag}>
              +
            </button>
          </span>
        </div>

        <div className="field-label">分类</div>
        <div className="move-folder-list">
          <button
            className={folderId === null ? 'selected' : ''}
            onClick={() => setFolderId(null)}
          >
            未分类
          </button>
          {folders.map((f) => (
            <button
              key={f.id}
              className={folderId === f.id ? 'selected' : ''}
              onClick={() => setFolderId(f.id)}
            >
              {f.name}
            </button>
          ))}
        </div>
        <div className="folder-new">
          <input
            value={newFolder}
            onChange={(e) => setNewFolder(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newFolder.trim()) {
                void api.folderAdd(newFolder.trim()).then((f) => {
                  setFolderId(f.id)
                  setNewFolder('')
                })
              }
            }}
            placeholder="新建分类…"
          />
        </div>

        <div className="regen-actions">
          <button onClick={onClose}>取消</button>
          <button className="regen-yes" onClick={() => void save()}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
