import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { CefrLevel, CEFR_LEVELS, FAV_TAG_PRESETS, Favorite, Folder, ShadowingResult, ShadowingScript } from '../../../shared/types'
import EditFavModal from '../components/EditFavModal'
import GridIcon from '../components/icons/GridIcon'
import ListIcon from '../components/icons/ListIcon'
import TrashIcon from '../components/icons/TrashIcon'
import UserSpeakIcon from '../components/icons/UserSpeakIcon'
import SearchIcon from '../components/icons/SearchIcon'
import EditIcon from '../components/icons/EditIcon'
import PageShell from '../components/PageShell'

type ViewMode = 'grid' | 'list'
/** 分组轴：分类（手动语义）/ 创作者（客观属性，虚拟分组不落库） */
type GroupAxis = 'folder' | 'creator'
/** 难度筛选：all 全部 / none 未评估 / 具体 CEFR 档 */
type LevelFilter = 'all' | 'none' | CefrLevel

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

/** 秒 → mm:ss / h:mm:ss */
function fmtDuration(s?: number): string | null {
  if (!s) return null
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`
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
  // 移动分类改为编辑弹窗（分类+难度+标签） / 删除两段确认
  const [editTarget, setEditTarget] = useState<Favorite | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  // 分组轴与筛选
  const [groupAxis, setGroupAxis] = useState<GroupAxis>('folder')
  const [selectedCreator, setSelectedCreator] = useState<string | null | undefined>(undefined)
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all')
  const [tagFilter, setTagFilter] = useState<string[]>([])

  const reload = useCallback(async (): Promise<void> => {
    setFolders(await api.folderList())
    setFavorites(await api.favList()) // 全量加载，分类/创作者/筛选都在前端做
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  // 后台补估难度：只对有字幕缓存的收藏（freq 离线估，零网络开销）
  useEffect(() => {
    for (const f of favorites) {
      if (f.level) continue
      void api.favEstimateLevel(f.videoId, 'freq', true).then((lv) => {
        if (lv) void reload()
      })
    }
  }, [favorites, reload])

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

  // 创作者分组（虚拟，不落库）：频道去重 + 计数；头像取该频道任一收藏的头像
  const creators = [...new Set(favorites.map((f) => f.channel).filter(Boolean))].sort()
  const countOfCreator = (c: string | undefined): number =>
    c === undefined ? favorites.length : favorites.filter((f) => f.channel === c).length
  const creatorAvatar = (c: string): string | null =>
    favorites.find((f) => f.channel === c && f.avatar)?.avatar ?? null
  /** 无头像兜底：名字首字母 + 按名字哈希的稳定色相 */
  const hueOf = (s: string): number => {
    let h = 0
    for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360
    return h
  }

  // 组合筛选：分组轴（分类/创作者）+ 搜索 + 难度 + 标签（多选"或"）
  const q = search.trim().toLowerCase()
  const filtered = favorites.filter((f) => {
    if (groupAxis === 'folder') {
      if (selectedFolder !== undefined && f.folderId !== (selectedFolder ?? null)) return false
    } else if (selectedCreator !== undefined && f.channel !== selectedCreator) return false
    if (q && !f.title.toLowerCase().includes(q) && !f.channel.toLowerCase().includes(q)) return false
    if (levelFilter === 'none' && f.level) return false
    if (levelFilter !== 'all' && levelFilter !== 'none' && f.level !== levelFilter) return false
    if (tagFilter.length > 0 && !tagFilter.some((t) => (f.tags ?? []).includes(t))) return false
    return true
  })

  // 筛选条上的可选标签：预设 + 收藏里已出现的自定义标签
  const customTagsInUse = [
    ...new Set(favorites.flatMap((f) => f.tags ?? []).filter((t) => !FAV_TAG_PRESETS.includes(t)))
  ]

  return (
    <PageShell
      title={`收藏的视频（${favorites.length}）`}
      desc="按分类或创作者管理，支持难度（CEFR）与内容标签筛选；卡片编辑按钮可改分类、难度、标签"
    >
      <div className="fav-body">
        <aside className="folder-bar">
          <div className="axis-toggle">
            <button
              className={groupAxis === 'folder' ? 'selected' : ''}
              onClick={() => setGroupAxis('folder')}
            >
              分类
            </button>
            <button
              className={groupAxis === 'creator' ? 'selected' : ''}
              onClick={() => setGroupAxis('creator')}
            >
              创作者
            </button>
          </div>
          {groupAxis === 'folder' ? (
            <>
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
            </>
          ) : (
            <>
              <button
                className={selectedCreator === undefined ? 'selected' : ''}
                onClick={() => setSelectedCreator(undefined)}
              >
                全部
                <span className="folder-count">{countOfCreator(undefined)}</span>
              </button>
              {creators.map((c) => (
                <button
                  key={c}
                  className={selectedCreator === c ? 'selected creator-item' : 'creator-item'}
                  title={c}
                  onClick={() => setSelectedCreator(c)}
                >
                  {creatorAvatar(c) ? (
                    <img className="creator-avatar" src={creatorAvatar(c)!} alt="" />
                  ) : (
                    <span
                      className="creator-avatar creator-initial"
                      style={{ background: `hsl(${hueOf(c)} 45% 40%)` }}
                    >
                      {c.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span className="folder-count">{countOfCreator(c)}</span>
                </button>
              ))}
            </>
          )}
        </aside>

        <div className="fav-main">
          {/* 单行控制条：难度 + 标签（块切换按钮）+ 搜索 + 视图切换 */}
          <div className="fav-controls">
            <span className="seg-tabs mini" role="group" aria-label="难度筛选">
              {(['all', 'none', ...CEFR_LEVELS] as LevelFilter[]).map((l) => (
                <button
                  key={l}
                  className={levelFilter === l ? 'selected' : ''}
                  onClick={() => setLevelFilter(l)}
                >
                  {l === 'all' ? '全部' : l === 'none' ? '未评估' : l}
                </button>
              ))}
            </span>
            <span className="seg-tabs mini fav-filter-seg" role="group" aria-label="标签筛选">
              {[...FAV_TAG_PRESETS, ...customTagsInUse].map((t) => (
                <button
                  key={t}
                  className={tagFilter.includes(t) ? 'selected' : ''}
                  onClick={() =>
                    setTagFilter((cur) =>
                      cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]
                    )
                  }
                >
                  {t}
                </button>
              ))}
            </span>
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
                <div className="fav-thumb">
                  <img src={fav.thumbnail} alt="" onClick={() => open(fav)} />
                  {fav.level && (
                    <span
                      className="thumb-badge thumb-badge-left"
                      title={fav.levelAuto ? '难度（自动估值）' : '难度（手动定级）'}
                    >
                      {fav.level}
                    </span>
                  )}
                  {fmtDuration(fav.duration) && (
                    <span className="thumb-badge thumb-badge-right">{fmtDuration(fav.duration)}</span>
                  )}
                </div>
                <div className="fav-info">
                  <div className="fav-title" onClick={() => open(fav)}>
                    {fav.title || fav.videoId}
                  </div>
                  <div className="fav-channel">{fav.channel}</div>
                  {(fav.tags ?? []).length > 0 && (
                    <div className="fav-badges">
                      {(fav.tags ?? []).map((t) => (
                        <span key={t} className="tag-badge">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
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
                      title="编辑（分类 / 难度 / 标签）"
                      onClick={() => setEditTarget(fav)}
                    >
                      <EditIcon />
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

      {editTarget && (
        <EditFavModal
          fav={editTarget}
          folders={folders}
          onClose={() => setEditTarget(null)}
          onSaved={() => void reload()}
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
