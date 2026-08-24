import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { Favorite, Folder, ShadowingResult } from '../../../shared/types'
import GridIcon from '../components/icons/GridIcon'
import ListIcon from '../components/icons/ListIcon'
import TrashIcon from '../components/icons/TrashIcon'
import UserSpeakIcon from '../components/icons/UserSpeakIcon'

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

  /** 跟读入口：已生成直接跳转；未生成则调 LLM 生成后跳转 */
  const openShadowing = async (fav: Favorite): Promise<void> => {
    const vid = fav.videoId
    setGenId(vid)
    try {
      const existing = await api.shadowingGet(vid)
      if (existing) {
        navigate(`/shadowing?v=${encodeURIComponent(vid)}`)
        return
      }
      const r = (await api.shadowingGenerate(vid)) as ShadowingResult
      if ('script' in r) {
        navigate(`/shadowing?v=${encodeURIComponent(vid)}`)
      } else {
        setGenMsg(
          r.error === 'no-llm'
            ? '请先在设置页配置 LLM API'
            : r.error === 'no-captions'
              ? '该视频没有可用字幕，无法生成脚本'
              : 'LLM 生成失败，请稍后重试'
        )
        setTimeout(() => setGenMsg(''), 3000)
      }
    } finally {
      setGenId(null)
    }
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
    </div>
  )
}
