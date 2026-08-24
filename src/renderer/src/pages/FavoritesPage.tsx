import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { Favorite, Folder, ShadowingResult, ShadowingScript } from '../../../shared/types'
import GridIcon from '../components/icons/GridIcon'
import ListIcon from '../components/icons/ListIcon'
import TrashIcon from '../components/icons/TrashIcon'
import UserSpeakIcon from '../components/icons/UserSpeakIcon'

const STRATEGY_LABEL: Record<string, string> = {
  'llm-only': '仅 LLM',
  'llm-fallback': 'LLM 优先，本地规则兜底',
  'rules-only': '仅本地规则'
}

const GENERATED_BY_LABEL: Record<string, string> = {
  llm: 'LLM',
  rules: '本地规则'
}

type ViewMode = 'grid' | 'list'

export default function FavoritesPage(): JSX.Element {
  const navigate = useNavigate()
  const [folders, setFolders] = useState<Folder[]>([])
  const [favorites, setFavorites] = useState<Favorite[]>([])
  const [selectedFolder, setSelectedFolder] = useState<string | null | undefined>(undefined)
  const [mode, setMode] = useState<ViewMode>('grid')
  const [newFolder, setNewFolder] = useState('')
  // 跟读脚本生成中：卡片按钮置灰；genMsg 为失败提示
  const [genId, setGenId] = useState<string | null>(null)
  const [genMsg, setGenMsg] = useState('')
  // 已有脚本与当前生成策略不一致时的确认目标
  const [regenTarget, setRegenTarget] = useState<{
    fav: Favorite
    existing: ShadowingScript
    strategy: string
  } | null>(null)

  const reload = useCallback(async (): Promise<void> => {
    setFolders(await api.folderList())
    setFavorites(await api.favList(selectedFolder))
  }, [selectedFolder])

  useEffect(() => {
    void reload()
  }, [reload])

  const createFolder = async (): Promise<void> => {
    const name = newFolder.trim()
    if (!name) return
    await api.folderAdd(name)
    setNewFolder('')
    void reload()
  }

  const removeFolder = async (id: string): Promise<void> => {
    await api.folderRemove(id)
    if (selectedFolder === id) setSelectedFolder(undefined)
    void reload()
  }

  const removeFavorite = async (videoId: string): Promise<void> => {
    await api.favRemove(videoId)
    void reload()
  }

  const open = (fav: Favorite): void => {
    navigate(`/browse?v=${encodeURIComponent(fav.videoId)}`)
  }

  /** 生成脚本并跳转跟读页；force 时覆盖已有脚本 */
  const generateAndGo = async (vid: string, force = false): Promise<void> => {
    setGenId(vid)
    try {
      const r = (await api.shadowingGenerate(vid, force)) as ShadowingResult
      if ('script' in r) {
        navigate(`/shadowing?v=${encodeURIComponent(vid)}`)
      } else {
        setGenMsg(
          r.error === 'no-llm'
            ? '请先在设置页配置 LLM API'
            : r.error === 'no-captions'
              ? '该视频没有可用字幕，无法生成脚本'
              : `生成失败${'detail' in r && r.detail ? `：${r.detail}` : '，请稍后重试'}`
        )
        setTimeout(() => setGenMsg(''), 3000)
      }
    } finally {
      setGenId(null)
    }
  }

  /** 跟读入口：未生成则生成后跳转；已生成且生成方式与当前策略不符时先确认 */
  const openShadowing = async (fav: Favorite): Promise<void> => {
    const vid = fav.videoId
    const existing = (await api.shadowingGet(vid)) as ShadowingScript | null
    if (!existing) {
      await generateAndGo(vid)
      return
    }
    const s = await api.settingsGet()
    const strategy = s.shadowingStrategy ?? 'llm-fallback'
    const by = existing.generatedBy
    // 老数据无 generatedBy 也算不一致，提示用户
    const mismatch =
      by === undefined ||
      (strategy === 'rules-only' && by !== 'rules') ||
      (strategy === 'llm-only' && by !== 'llm') ||
      (strategy === 'llm-fallback' && by === 'rules')
    if (mismatch) {
      setRegenTarget({ fav, existing, strategy })
      return
    }
    navigate(`/shadowing?v=${encodeURIComponent(vid)}`)
  }

  return (
    <div className="page favorites-page">
      <aside className="folder-bar">
        <button
          className={selectedFolder === undefined ? 'selected' : ''}
          onClick={() => setSelectedFolder(undefined)}
        >
          全部
        </button>
        <button
          className={selectedFolder === null ? 'selected' : ''}
          onClick={() => setSelectedFolder(null)}
        >
          未分类
        </button>
        {folders.map((f) => (
          <div key={f.id} className="folder-row">
            <button
              className={selectedFolder === f.id ? 'selected' : ''}
              onClick={() => setSelectedFolder(f.id)}
            >
              {f.name}
            </button>
            <span
              className="folder-del"
              title="删除分类"
              onClick={() => void removeFolder(f.id)}
            >
              <TrashIcon />
            </span>
          </div>
        ))}
        <div className="folder-new">
          <input
            value={newFolder}
            onChange={(e) => setNewFolder(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void createFolder()}
            placeholder="新文件夹名"
          />
          <button onClick={() => void createFolder()}>+</button>
        </div>
      </aside>
      <div className="fav-main">
        <div className="page-head">
          <div className="page-head-row">
            <h2>收藏的视频</h2>
            {genMsg && <span className="fav-gen-msg">{genMsg}</span>}
            <div className="mode-toggle">
            <button
              className={mode === 'grid' ? 'icon-btn selected' : 'icon-btn'}
              title="缩略图"
              onClick={() => setMode('grid')}
            >
              <GridIcon />
            </button>
            <button
              className={mode === 'list' ? 'icon-btn selected' : 'icon-btn'}
              title="列表"
              onClick={() => setMode('list')}
            >
              <ListIcon />
            </button>
          </div>
          </div>
          <div className="page-desc">按分类管理收藏的视频，点卡片上的跟读按钮可生成口语练习脚本</div>
        </div>
        {favorites.length === 0 && <div className="empty-hint">还没有收藏，去浏览页收藏视频吧</div>}
        <div className={mode === 'grid' ? 'fav-grid' : 'fav-list'}>
          {favorites.map((fav) => (
            <div key={fav.videoId} className="fav-card">
              <img src={fav.thumbnail} alt="" onClick={() => open(fav)} />
              <div className="fav-info">
                <div className="fav-title" onClick={() => open(fav)}>
                  {fav.title || fav.videoId}
                </div>
                <div className="fav-channel">{fav.channel}</div>
              </div>
              <div className="fav-card-actions">
                <button
                  className="fav-remove icon-btn"
                  title="移除"
                  onClick={() => void removeFavorite(fav.videoId)}
                >
                  <TrashIcon />
                </button>
                <button
                  className="fav-shadow icon-btn"
                  title={genId === fav.videoId ? '正在生成跟读脚本…' : '跟读练习'}
                  disabled={genId === fav.videoId}
                  onClick={() => void openShadowing(fav)}
                >
                  <UserSpeakIcon />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
      {regenTarget && (
        <div className="regen-overlay" onClick={() => setRegenTarget(null)}>
          <div className="regen-card" onClick={(e) => e.stopPropagation()}>
            <div className="regen-title">该视频已有跟读脚本</div>
            <div className="regen-desc">
              脚本由「
              {GENERATED_BY_LABEL[regenTarget.existing.generatedBy ?? ''] ?? '未知方式（旧版本）'}
              」生成；当前生成策略为「{STRATEGY_LABEL[regenTarget.strategy]}」。 是否按当前策略重新生成？
            </div>
            <div className="regen-actions">
              <button
                onClick={() => {
                  const t = regenTarget
                  setRegenTarget(null)
                  navigate(`/shadowing?v=${encodeURIComponent(t.fav.videoId)}`)
                }}
              >
                继续使用旧脚本
              </button>
              <button
                className="regen-yes"
                onClick={() => {
                  const t = regenTarget
                  setRegenTarget(null)
                  void generateAndGo(t.fav.videoId, true)
                }}
              >
                重新生成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
