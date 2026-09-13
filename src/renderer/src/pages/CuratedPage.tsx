import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { CuratedVideo, rankCurated } from '../../../shared/curated'
import { CEFR_LEVELS, CefrLevel, FAV_TAG_PRESETS, Favorite } from '../../../shared/types'
import PageShell from '../components/PageShell'
import Pagination from '../components/Pagination'
import StarOutlineIcon from '../components/icons/StarOutlineIcon'
import RocketIcon from '../components/icons/RocketIcon'
import { CURATED_CUES_URL_BASE } from '../../../shared/curated-config'
import { fmtDuration, hueOf } from '../lib/format'

/** 精选页：按自评水平 + 兴趣标签从本地内容库推荐视频（Phase 0 单机版） */
export default function CuratedPage(): JSX.Element {
  const navigate = useNavigate()
  const [videos, setVideos] = useState<CuratedVideo[]>([])
  const [favs, setFavs] = useState<Favorite[]>([])
  const [level, setLevel] = useState<CefrLevel | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [justFaved, setJustFaved] = useState<string[]>([])

  useEffect(() => {
    void api.curatedList().then((l) => setVideos(l as CuratedVideo[]))
    void api.favList().then((l) => setFavs(l as Favorite[]))
    void api.settingsGet().then((s) => {
      setLevel(s.curatedLevel ?? null)
      setTags(s.curatedTags ?? [])
    })
  }, [])

  const savePrefs = useCallback((lv: CefrLevel | null, tg: string[]): void => {
    void api.settingsSet({ curatedLevel: lv, curatedTags: tg })
  }, [])

  const seenIds = useMemo(() => new Set(favs.map((f) => f.videoId)), [favs])
  // 创作者筛选（左栏）：null = 全部
  const [creatorFilter, setCreatorFilter] = useState<string | null>(null)
  // 左栏滚动：下滑后右下角浮出"回顶部"小火箭
  const creatorBarRef = useRef<HTMLElement>(null)
  const [showTop, setShowTop] = useState(false)
  const creators = useMemo(
    () => [...new Set(videos.map((v) => v.channel).filter(Boolean))].sort(),
    [videos]
  )
  // 创作者搜索：按输入过滤左栏列表
  const [creatorQuery, setCreatorQuery] = useState('')
  const creatorsShown = useMemo(
    () =>
      creatorQuery.trim()
        ? creators.filter((c) => c.toLowerCase().includes(creatorQuery.trim().toLowerCase()))
        : creators,
    [creators, creatorQuery]
  )
  const creatorCount = (c: string | null): number =>
    c === null ? videos.length : videos.filter((v) => v.channel === c).length
  // 收藏夹里同频道有头像就复用，更有辨识度
  const creatorAvatar = (c: string): string | null =>
    favs.find((f) => f.channel === c && f.avatar)?.avatar ?? null
  // 当天日期做种子：同一天推荐稳定，明天换新；按 24 部一批翻页轮换
  const dateSeed = new Date().toISOString().slice(0, 10)
  // 分页：0 基页码；筛选条件变化时自动回第 1 页
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [level, tags, creatorFilter, videos])
  const ranked = useMemo(() => {
    // 硬筛选：创作者 + 难度（选中时只出该档）+ 标签（多选"或"），再按推荐排序
    const pool = videos.filter((v) => {
      if (creatorFilter && v.channel !== creatorFilter) return false
      if (level && v.level !== level) return false
      if (tags.length > 0 && !tags.some((t) => v.tags.includes(t))) return false
      return true
    })
    return rankCurated(pool, { level, tags }, seenIds, dateSeed)
  }, [videos, creatorFilter, level, tags, seenIds, dateSeed])
  const PAGE_SIZE = 24
  const pageCount = Math.max(1, Math.ceil(ranked.length / PAGE_SIZE))
  const cur = Math.min(page, pageCount - 1)
  const pageItems = ranked.slice(cur * PAGE_SIZE, cur * PAGE_SIZE + PAGE_SIZE)

  // 库里实际存在的标签（预设 + 库里出现的自定义）
  const availableTags = useMemo(
    () => [...new Set([...FAV_TAG_PRESETS, ...videos.flatMap((v) => v.tags)])],
    [videos]
  )

  const fav = async (v: CuratedVideo): Promise<void> => {
    await api.favAdd({
      videoId: v.videoId,
      title: v.title,
      channel: v.channel,
      thumbnail: v.thumbnail,
      folderId: null,
      duration: v.duration,
      ytCategory: v.ytCategory
    })
    setJustFaved((c) => [...c, v.videoId])
    void api.favList().then((l) => setFavs(l as Favorite[]))
  }

  /** 打开精选视频：字幕优先用快照内嵌的，没有则从 R2 按需取（元数据快照不含字幕）写缓存 */
  const openVideo = async (v: CuratedVideo): Promise<void> => {
    let cues = v.cues
    if ((!cues || cues.length === 0) && CURATED_CUES_URL_BASE) {
      try {
        const r = await fetch(`${CURATED_CUES_URL_BASE}${v.videoId}.json`)
        if (r.ok) cues = (await r.json()) as CuratedVideo['cues']
      } catch {
        /* 取不到就走在线抓取链路 */
      }
    }
    if (cues && cues.length > 0) {
      void api.captionsPutCache(v.videoId, {
        title: v.title,
        channel: v.channel,
        duration: v.duration,
        ytCategory: v.ytCategory,
        en: cues,
        zh: null
      }).catch(() => {})
    }
    navigate(`/browse?v=${encodeURIComponent(v.videoId)}`)
  }

  return (
    <PageShell fill title="精选" desc="按你的水平和兴趣推荐；打开即进入完整学习功能">
      <div className="fav-body">
        {/* 左栏：创作者筛选 */}
        <aside
          className="folder-bar"
          ref={creatorBarRef}
          onScroll={(e) => setShowTop(e.currentTarget.scrollTop > 200)}
        >
          <button className={creatorFilter === null ? 'selected' : ''} onClick={() => setCreatorFilter(null)}>
            全部
            <span className="folder-count">{creatorCount(null)}</span>
          </button>
          <input
            className="creator-search"
            type="text"
            placeholder="搜索创作者"
            value={creatorQuery}
            onChange={(e) => setCreatorQuery(e.target.value)}
          />
          {creatorsShown.map((c) => (
            <button
              key={c}
              className={creatorFilter === c ? 'selected creator-item' : 'creator-item'}
              title={c}
              onClick={() => setCreatorFilter(c)}
            >
              {creatorAvatar(c) ? (
                <img className="creator-avatar" src={creatorAvatar(c)!} alt="" />
              ) : (
                <span className="creator-avatar creator-initial" style={{ background: `hsl(${hueOf(c)} 45% 40%)` }}>
                  {c.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="creator-name">{c}</span>
              <span className="folder-count">{creatorCount(c)}</span>
            </button>
          ))}
          {showTop && (
            <button
              className="rocket-top"
              title="回到顶部"
              onClick={() => creatorBarRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
            >
              <RocketIcon />
            </button>
          )}
        </aside>

        <div className="fav-main fixed-main">
          {/* 偏好：水平 + 标签（存设置，实时生效） */}
          <div className="fav-controls">
        <span className="seg-tabs mini" role="group" aria-label="我的水平">
          <button className={level === null ? 'selected' : ''} onClick={() => { setLevel(null); savePrefs(null, tags) }}>
            不限
          </button>
          {CEFR_LEVELS.map((l) => (
            <button
              key={l}
              className={level === l ? 'selected' : ''}
              onClick={() => { setLevel(l); savePrefs(l, tags) }}
            >
              {l}
            </button>
          ))}
        </span>
        <span className="seg-tabs mini fav-filter-seg" role="group" aria-label="兴趣标签">
          {availableTags.map((t) => (
            <button
              key={t}
              className={tags.includes(t) ? 'selected' : ''}
              onClick={() => {
                const next = tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t]
                setTags(next)
                savePrefs(level, next)
              }}
            >
              {t}
            </button>
          ))}
        </span>
        <Pagination page={cur} pageCount={pageCount} onChange={setPage} />
      </div>

      {/* 卡片列表（内部滚动，操作栏固定） */}
      <div className="list-scroll">
      {videos.length === 0 ? (
        <div className="empty-hint">
          内容加载中或为空，稍后再试
        </div>
      ) : ranked.length === 0 ? (
        <div className="empty-hint">当前筛选条件下没有匹配的精选，放宽难度或标签试试</div>
      ) : (
        <div className="fav-grid">
            {pageItems.map((v) => (
            <div key={v.videoId} className="fav-card">
              <div className="fav-thumb">
                <img
                  src={v.thumbnail}
                  alt=""
                  onClick={() => openVideo(v)}
                />
                {v.level && <span className="thumb-badge thumb-badge-left">{v.level}</span>}
                <span className="thumb-badge thumb-badge-right">{fmtDuration(v.duration)}</span>
              </div>
              <div className="fav-info">
                <div
                  className="fav-title"
                  onClick={() => openVideo(v)}
                >
                  {v.title}
                </div>
                <div className="fav-channel">{v.channel}</div>
                {v.tags.length > 0 && (
                  <div className="fav-badges">
                    {v.tags.map((t) => (
                      <span key={t} className="tag-badge">{t}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="fav-card-actions">
                <span className="fav-card-actions-right">
                  {seenIds.has(v.videoId) || justFaved.includes(v.videoId) ? (
                    <span className="popup-saved">已收藏</span>
                  ) : (
                    <button className="icon-btn" title="加入收藏" onClick={() => void fav(v)}>
                      <StarOutlineIcon />
                    </button>
                  )}
                </span>
              </div>
            </div>
          ))}
          </div>
      )}
      </div>
        </div>
      </div>
    </PageShell>
  )
}
