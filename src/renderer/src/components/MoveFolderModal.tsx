import { useState } from 'react'
import { api } from '../api'
import { Favorite, Folder } from '../../../shared/types'

interface Props {
  fav: Favorite
  folders: Folder[]
  onClose: () => void
  /** 移动成功后由父组件刷新列表 */
  onMoved: () => void
}

/** 移动收藏到分类：选中即移；底部可新建文件夹并移入 */
export default function MoveFolderModal({ fav, folders, onClose, onMoved }: Props): JSX.Element {
  const [newFolder, setNewFolder] = useState('')

  const move = async (folderId: string | null): Promise<void> => {
    await api.favMove(fav.videoId, folderId)
    onMoved()
    onClose()
  }

  const createAndMove = async (): Promise<void> => {
    const name = newFolder.trim()
    if (!name) return
    const folder = await api.folderAdd(name)
    await move(folder.id)
  }

  return (
    <div className="regen-overlay" onClick={onClose}>
      <div className="regen-card" onClick={(e) => e.stopPropagation()}>
        <div className="regen-title">移动到分类</div>
        <div className="regen-desc" title={fav.title}>
          {fav.title || fav.videoId}
        </div>
        <div className="move-folder-list">
          <button onClick={() => void move(null)}>未分类</button>
          {folders.map((f) => (
            <button key={f.id} onClick={() => void move(f.id)}>
              {f.name}
              {fav.folderId === f.id && <span className="move-current">当前</span>}
            </button>
          ))}
        </div>
        <div className="folder-new">
          <input
            value={newFolder}
            onChange={(e) => setNewFolder(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void createAndMove()}
            placeholder="新建文件夹并移入…"
          />
          <button disabled={!newFolder.trim()} onClick={() => void createAndMove()}>
            创建
          </button>
        </div>
      </div>
    </div>
  )
}
