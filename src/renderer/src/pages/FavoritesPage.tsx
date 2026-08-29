import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { Favorite, Folder, ShadowingResult, ShadowingScript } from '../../../shared/types'
import MoveFolderModal from '../components/MoveFolderModal'
import GridIcon from '../components/icons/GridIcon'
import ListIcon from '../components/icons/ListIcon'
import TrashIcon from '../components/icons/TrashIcon'
import UserSpeakIcon from '../components/icons/UserSpeakIcon'
import SearchIcon from '../components/icons/SearchIcon'
import FolderInputIcon from '../components/icons/FolderInputIcon'
import PageShell from '../components/PageShell'

type ViewMode = 'grid' | 'list'

const STRATEGY_LABEL: Record<string, string> = {
  'llm-only': '仅 LLM',
  'llm-fallback': 'LLM 优先，本地规则兜底',
  'rules-only': '仅本地规则',
  raw: '直接使用字幕'
}

const GENERATED_BY_LABEL: Record<string, string> = {
  llm: 'LLM',
  rules: '本地规则',
  raw: '原始字幕'
}

/** 各策略期望的生成方式（不一致时提示重新生成） */
const STRATEGY_EXPECT: Record<string, string> = {
  'llm-only': 'llm',
  'llm-fallback': 'llm',
  'rules-only': 'rules',
  raw: 'raw'
}

export default function FavoritesPage(): JSX.Element {
  const navigate = useNavigate()
  const [folders, setFolders] = useState<Folder[]>([])
  const [favorites, setFavorites] = useState<Favorite[]>([])
  const [selectedFolder, setSelectedFolder] = useState<string | null | undefined>(undefined)
  const [mode, setMode] = useState<ViewMode>('grid')
  const [newFolder, setNewFolder] = useState('')
  // 收藏页内搜索（标题/作者）
  const [search, setSearch] = useState('')
  // 跟读脚本生成中：卡片按钮置灰；genMsg 为失败提示
  const [genId, setGenId] = useState<string | null>(null)
  const [genMsg, setGenMsg] = useState('')
  // 已有脚本与当前生成策略不一致时的确认目标
  const [regenTarget, setRegenTarget] = useState<{
    fav: Favorite
    existing: ShadowingScript
    strategy: string
  } | null>(null)
  // 移动分类 / 删除两段确认
  const [moveTarget, setMoveTarget] = useState<Favorite | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

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
    setDeleteConfirmId(null)
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
    const mismatch = by === undefined || by !== STRATEGY_EXPECT[strategy]
    if (mismatch) {
      setRegenTarget({ fav, existing, strategy })
      return
    }
    navigate(`/shadowing?v=${encodeURIComponent(vid)}`)
  }

  const countOf = (folderId: string | null | undefined): number => {
    if (folderId === undefined) return favorites.length
    return favorites.filter((f) => f.folderId === (folderId ?? null)).length
  }

  const q = search.trim().toLowerCase()
  const filtered = q
    ? favorites.filter(
        (f) => f.title.toLowerCase().includes(q) || f.channel.toLowerCase().includes(q)
      )
    : favorites

  const currentFolderName =
    selectedFolder === undefined
      ? '全部'
      : selectedFolder === null
        ? '未分类'
        : (folders.find((f) => f.id === selectedFolder)?.name ?? '')

  return (
    <PageShell
      title={`收藏的视频（${favorites.length}）`}
      desc="按分类管理收藏的视频，点卡片上的跟读按钮可生成口语练习脚本"
    >
      <div className="fav-body">
        <aside className="folder-bar">
          <button
            className={selectedFolder === undefined ? 'selected' : ''}
            onClick={() => setSelectedFolder(undefined)}
          >
            全部
            <span className="folder-count">{countOf(undefined)}</span>
          </button>
          <button
            className={selectedFolder === null ? 'selected' : ''}
            onClick={() => setSelectedFolder(null)}
          >
            未分类
            <span className="folder-count">{countOf(null)}</span>
          </button>
          {folders.map((f) => (
            <div key={f.id} className="folder-row">
              <button
                className={selectedFolder === f.id ? 'selected' : ''}
                onClick={() => setSelectedFolder(f.id)}
              >
                {f.name}
                <span className="folder-count">{countOf(f.id)}</span>
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
          <div className="fav-controls">
            <div className="fav-controls-title">
              {currentFolderName} <span>（{filtered.length} 个视频）</span>
            </div>
            <div className="fav-controls-right">
              {genMsg && <span className="fav-gen-msg">{genMsg}</span>}
              <div className="fav-search">
                <SearchIcon />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索收藏视频或作者…"
                />
              </div>
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
          </div>

          {filtered.length === 0 && (
            <div className="empty-hint">
              {favorites.length === 0 ? '还没有收藏，去浏览页收藏视频吧' : '没有匹配的收藏'}
            </div>
          )}
          <div className={mode === 'grid' ? 'fav-grid' : 'fav-list'}>
            {filtered.map((fav) => (
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
                    className="fav-shadow icon-btn"
                    title={genId === fav.videoId ? '正在生成跟读脚本…' : '跟读练习'}
                    disabled={genId === fav.videoId}
                    onClick={() => void openShadowing(fav)}
                  >
                    <UserSpeakIcon />
                  </button>
                  <span className="fav-card-actions-right">
                    <button
                      className="icon-btn"
                      title="移动到分类"
                      onClick={() => setMoveTarget(fav)}
                    >
                      <FolderInputIcon />
                    </button>
                    {deleteConfirmId === fav.videoId ? (
                      <span className="fav-del-confirm">
                        <button
                          className="fav-del-yes"
                          onClick={() => void removeFavorite(fav.videoId)}
                        >
                          删除
                        </button>
                        <button onClick={() => setDeleteConfirmId(null)}>取消</button>
                      </span>
                    ) : (
                      <button
                        className="fav-remove icon-btn"
                        title="移除"
                        onClick={() => setDeleteConfirmId(fav.videoId)}
                      >
                        <TrashIcon />
                      </button>
                    )}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {moveTarget && (
        <MoveFolderModal
          fav={moveTarget}
          folders={folders}
          onClose={() => setMoveTarget(null)}
          onMoved={() => void reload()}
        />
      )}

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
    </PageShell>
  )
}
