import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, FAVS_CHANGED_EVENT } from '../api'
import { Favorite, Folder } from '../../../shared/types'

interface Group {
  key: string
  name: string
  items: Favorite[]
}

/** 浏览页左侧面板里的收藏列表：按分类分组，组可折叠，点击视频直接打开 */
export default function FavoritesTab(): JSX.Element {
  const [folders, setFolders] = useState<Folder[]>([])
  const [favorites, setFavorites] = useState<Favorite[]>([])
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  // 展示模式：网格（缩略图+标题块，每行两个）/ 列表（前置小缩略图）
  const [mode, setMode] = useState<'grid' | 'list'>('grid')
  const navigate = useNavigate()

  useEffect(() => {
    const load = (): void => {
      void Promise.all([api.folderList(), api.favList()]).then(([fs, favs]) => {
        setFolders(fs)
        setFavorites(favs)
      })
    }
    load()
    window.addEventListener(FAVS_CHANGED_EVENT, load)
    return () => window.removeEventListener(FAVS_CHANGED_EVENT, load)
  }, [])

  const groups: Group[] = [
    ...folders.map((f) => ({
      key: f.id,
      name: f.name,
      items: favorites.filter((v) => v.folderId === f.id)
    })),
    { key: '', name: '未分类', items: favorites.filter((v) => v.folderId === null) }
  ].filter((g) => g.items.length > 0)

  const toggle = (key: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (favorites.length === 0) {
    return <div className="favtab-empty">还没有收藏，点导航栏 ☆ 收藏当前视频</div>
  }

  return (
    <div className="favtab">
      <div className="favtab-toolbar">
        <div className="mode-toggle">
          <button
            className={mode === 'grid' ? 'selected' : ''}
            onClick={() => setMode('grid')}
            title="网格"
          >
            ▦
          </button>
          <button
            className={mode === 'list' ? 'selected' : ''}
            onClick={() => setMode('list')}
            title="列表"
          >
            ☰
          </button>
        </div>
      </div>
      {groups.map((g) => (
        <div key={g.key} className="favtab-group">
          <div className="favtab-header" onClick={() => toggle(g.key)}>
            <span className="favtab-arrow">{collapsed.has(g.key) ? '▸' : '▾'}</span>
            <span className="favtab-name">{g.name}</span>
            <span className="favtab-count">{g.items.length}</span>
          </div>
          {!collapsed.has(g.key) && (
            <div className={mode === 'grid' ? 'favtab-grid' : 'favtab-list'}>
              {g.items.map((fav) => (
                <div
                  key={fav.videoId}
                  className="favtab-item"
                  onClick={() => navigate(`/browse?v=${encodeURIComponent(fav.videoId)}`)}
                >
                  <img src={fav.thumbnail} loading="lazy" alt="" />
                  <div className="favtab-text">
                    <div className="favtab-title">{fav.title}</div>
                    <div className="favtab-channel">{fav.channel}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
