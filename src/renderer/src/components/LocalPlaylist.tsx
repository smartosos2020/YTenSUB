import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { LocalVideoFolder } from '../../../shared/local-media'
import { api } from '../api'
import RefreshIcon from './icons/RefreshIcon'
import CloseIcon from './icons/CloseIcon'
import PlayIcon from './icons/PlayIcon'
import FolderPlusIcon from './icons/FolderPlusIcon'
import PlayerIconButton from './PlayerIconButton'

interface Props {
  currentPath?: string
  openingPath: string | null
  onPlay: (filePath: string) => void
  actionsContainer: HTMLSpanElement | null
  refreshContainer: HTMLSpanElement | null
  onShowPlaylist: () => void
}

export default function LocalPlaylist({ currentPath, openingPath, onPlay, actionsContainer, refreshContainer, onShowPlaylist }: Props): JSX.Element {
  const [folders, setFolders] = useState<LocalVideoFolder[]>([])
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    void api.localPlaylistList()
      .then((result) => { if (alive) setFolders(result) })
      .catch(() => { if (alive) setError('无法读取播放列表，请点击刷新重试') })
      .finally(() => { if (alive) setBusy(false) })
    return () => { alive = false }
  }, [currentPath])

  const refresh = async (): Promise<void> => {
    onShowPlaylist()
    setBusy(true)
    setError('')
    try {
      setFolders(await api.localPlaylistList())
    } catch {
      setError('无法读取播放列表，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  const addFolder = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const folder = await api.localPlaylistAddFolder()
      if (!folder) return
      setFolders((previous) => [...previous.filter((item) => item.path !== folder.path), folder])
      setCollapsed((previous) => {
        const next = new Set(previous)
        next.delete(folder.path)
        return next
      })
      onShowPlaylist()
    } catch {
      setError('无法添加文件夹，请检查路径和读取权限')
    } finally {
      setBusy(false)
    }
  }

  const removeFolder = async (folderPath: string): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await api.localPlaylistRemoveFolder(folderPath)
      setFolders((previous) => previous.filter((folder) => folder.path !== folderPath))
    } catch {
      setError('移出播放列表失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  const toggleFolder = (folderPath: string): void => {
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (next.has(folderPath)) next.delete(folderPath)
      else next.add(folderPath)
      return next
    })
  }

  return (
    <div className="local-playlist">
      {actionsContainer && createPortal(
        <PlayerIconButton label="添加文件夹" disabled={busy} onClick={() => void addFolder()}>
          <FolderPlusIcon />
        </PlayerIconButton>,
        actionsContainer
      )}
      {refreshContainer && createPortal(
        <PlayerIconButton label="刷新播放列表" disabled={busy} onClick={() => void refresh()}>
          <RefreshIcon />
        </PlayerIconButton>,
        refreshContainer
      )}
      {error && <p className="local-playlist-message" role="alert">{error}</p>}
      {busy && <p className="local-playlist-message" role="status">正在读取文件夹…</p>}
      <div className="local-playlist-folders">
        {!busy && !folders.length && <p className="local-playlist-message">添加视频所在的文件夹，点击视频即可播放</p>}
        {folders.map((folder) => (
          <section className="local-playlist-folder" key={folder.path}>
            <div className="local-playlist-folder-header">
              <button
                className="local-playlist-folder-toggle"
                aria-expanded={!collapsed.has(folder.path)}
                title={folder.path}
                onClick={() => toggleFolder(folder.path)}
              >
                <span aria-hidden="true">{collapsed.has(folder.path) ? '▸' : '▾'}</span>
                <b>{folder.name}</b>
                <small>{folder.videos.length}</small>
              </button>
              <button
                disabled={busy}
                className="local-playlist-remove"
                aria-label={`将 ${folder.name} 移出播放列表`}
                title="移出播放列表"
                onClick={() => void removeFolder(folder.path)}
              >
                <CloseIcon />
              </button>
            </div>
            {!collapsed.has(folder.path) && (
              <div className="local-playlist-videos">
                {folder.error && <p className="local-playlist-message" role="alert">{folder.error}</p>}
                {!folder.error && !folder.videos.length && <p className="local-playlist-message">此文件夹中没有支持的视频文件</p>}
                {folder.videos.map((video) => (
                  <button
                    key={video.path}
                    className={`local-playlist-video${currentPath === video.path ? ' selected' : ''}`}
                    aria-current={currentPath === video.path ? 'true' : undefined}
                    disabled={openingPath !== null}
                    title={video.name}
                    onClick={() => onPlay(video.path)}
                  >
                    <PlayIcon />
                    <span>{video.name}</span>
                    {openingPath === video.path && <small>打开中…</small>}
                  </button>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}
