import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { Favorite, Folder } from '../../../shared/types'
import GridIcon from '../components/icons/GridIcon'
import ListIcon from '../components/icons/ListIcon'
import TrashIcon from '../components/icons/TrashIcon'

type ViewMode = 'grid' | 'list'

export default function FavoritesPage(): JSX.Element {
  const navigate = useNavigate()
  const [folders, setFolders] = useState<Folder[]>([])
  const [favorites, setFavorites] = useState<Favorite[]>([])
  const [selectedFolder, setSelectedFolder] = useState<string | null | undefined>(undefined)
  const [mode, setMode] = useState<ViewMode>('grid')
  const [newFolder, setNewFolder] = useState('')

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
        <div className="fav-toolbar">
          <h2>收藏的视频</h2>
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
              <button
                className="fav-remove icon-btn"
                title="移除"
                onClick={() => void removeFavorite(fav.videoId)}
              >
                <TrashIcon />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
