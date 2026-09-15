import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { CuratedVideo, rankCurated } from '../../../shared/curated'
import { CEFR_LEVELS, CefrLevel, FAV_TAG_PRESETS, Favorite } from '../../../shared/types'
import { AuthSession, Plan, fetchFilterSensitive, fetchProCues } from '../../../shared/auth-api'
import { effectiveCachedPlan, FREE_DAILY_QUOTA } from '../../../shared/entitlement'
import { filterSensitiveVideos } from '../../../shared/sensitive'
import {
  CuratedFeedback,
  emptyFeedback,
  markNotInterestedChannel,
  markNotInterestedVideo,
  markWatched
} from '../../../shared/curated-feedback'
import { schedulePrefsPush, syncEntitlementCache } from '../lib/account-sync'
import PageShell from '../components/PageShell'
import Pagination from '../components/Pagination'
import PaywallModal from '../components/PaywallModal'
import StarOutlineIcon from '../components/icons/StarOutlineIcon'
import LockIcon from '../components/icons/LockIcon'
import DotsIcon from '../components/icons/DotsIcon'
import RocketIcon from '../components/icons/RocketIcon'
import { CURATED_CUES_URL_BASE } from '../../../shared/curated-config'
import { fmtDuration, hueOf } from '../lib/format'

/** 精选页：按自评水平 + 兴趣标签从本地内容库推荐视频；免费档每日前 FREE_DAILY_QUOTA 部，付费档不限 */
export default function CuratedPage(): JSX.Element {
  const navigate = useNavigate()
  const [videos, setVideos] = useState<CuratedVideo[]>([])
  const [favs, setFavs] = useState<Favorite[]>([])
  const [level, setLevel] = useState<CefrLevel | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [justFaved, setJustFaved] = useState<string[]>([])
  // 当前档位（fail closed 默认 free）；锁定卡片点击时弹付费墙
  const [plan, setPlan] = useState<Plan>('free')
  const [paywallOpen, setPaywallOpen] = useState(false)
  // 登录会话（pro+ 字幕秒出等付费通道要用 token）
  const [session, setSession] = useState<AuthSession | null>(null)
  // 敏感话题过滤开关（三级解析，fail closed 默认 true，客户端不做本地持久化）：
  // ① 在线求证的权益响应 filterSensitive 字段（用户级：admin 强制开/关 > 全局开关，服务端已解析）
  // ② 未登录或在线求证失败 → 公共全局开关 /config/filter-sensitive
  // ③ 都失败 → true（合规优先）
  const [filterSensitive, setFilterSensitive] = useState(true)
  // 推荐反馈（⑨）：不感兴趣隐藏/频道沉底/已看完沉底；fbMenuFor = 当前打开反馈菜单的 videoId
  const [feedback, setFeedback] = useState<CuratedFeedback>(emptyFeedback())
  const [fbMenuFor, setFbMenuFor] = useState<string | null>(null)

  useEffect(() => {
    void api.curatedList().then((l) => setVideos(l as CuratedVideo[]))
    void api.favList().then((l) => setFavs(l as Favorite[]))
    api.curatedFeedbackGet()
      .then(setFeedback)
      .catch(() => {})
    void api.settingsGet().then((s) => {
      setLevel(s.curatedLevel ?? null)
      setTags(s.curatedTags ?? [])
    })
    // 档位判定 + 敏感开关解析：先按本地缓存（离线按 graceDays 宽限），有 session 再在线求证并刷新缓存
    void (async () => {
      // 未登录/求证失败的公共兜底；再失败维持默认 true
      const fallBackToGlobal = (): void => {
        fetchFilterSensitive()
          .then((r) => setFilterSensitive(r.on))
          .catch(() => {})
      }
      const [auth, cached] = await Promise.all([api.authGet(), api.entitlementGet()])
      setSession(auth)
      setPlan(effectiveCachedPlan(cached, Date.now()))
      // 本地缓存带用户级字段就先顶上（undefined = 旧缓存没有该字段，不动 fail-closed 默认值）
      if (cached?.filterSensitive !== undefined) setFilterSensitive(cached.filterSensitive)
      if (!auth) {
        fallBackToGlobal()
        return
      }
      const fresh = await syncEntitlementCache(auth.token)
      if (fresh) {
        setPlan(effectiveCachedPlan(fresh, Date.now()))
        // 用户级生效值（缓存已随 syncEntitlementCache 落库）；缺省按 true
        setFilterSensitive(fresh.filterSensitive ?? true)
      } else {
        fallBackToGlobal()
      }
    })()
  }, [])

  const savePrefs = useCallback((lv: CefrLevel | null, tg: string[]): void => {
    void api.settingsSet({ curatedLevel: lv, curatedTags: tg })
    // 偏好随账号同步：仅登录且付费档才上云（服务端强制，403/离线静默）
    schedulePrefsPush(lv, tg)
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
    // 敏感话题过滤在排序前套用：免费档"前 N 部"额度作用于过滤后的列表
    // feedback（⑨）：不感兴趣的视频在 rankCurated 内隐藏、其频道与已看完的沉底
    return rankCurated(filterSensitiveVideos(pool, filterSensitive), { level, tags }, seenIds, dateSeed, feedback)
  }, [videos, creatorFilter, level, tags, filterSensitive, feedback, seenIds, dateSeed])
  const PAGE_SIZE = 24
  const pageCount = Math.max(1, Math.ceil(ranked.length / PAGE_SIZE))
  const cur = Math.min(page, pageCount - 1)
  const pageItems = ranked.slice(cur * PAGE_SIZE, cur * PAGE_SIZE + PAGE_SIZE)

  // 库里实际存在的标签（预设 + 库里出现的自定义）
  const availableTags = useMemo(
    () => [...new Set([...FAV_TAG_PRESETS, ...videos.flatMap((v) => v.tags)])],
    [videos]
  )

  /** 推荐反馈（⑨）：即时生效——写库 + 更新 state 触发重排，菜单收起 */
  const applyFeedback = (fb: CuratedFeedback): void => {
    setFeedback(fb)
    setFbMenuFor(null)
    void api.curatedFeedbackSet(fb)
  }

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

  /** 打开精选视频：字幕优先用快照内嵌的，pro+ 走服务端秒出，否则从公共 R2 按需取（元数据快照不含字幕）写缓存 */
  const openVideo = async (v: CuratedVideo): Promise<void> => {
    let cues = v.cues
    // C2 字幕秒出（pro+ 专属服务端通道）：403/404/网络失败静默回退到下方公共 R2 路径。
    // D4-B 切换（公共 cues 下线）后：免费/pro 走 innertube 自抓兜底，pro+ 走本分支——即双闸门的客户端半闸
    if ((!cues || cues.length === 0) && plan === 'pro_plus' && session) {
      try {
        const proCues = await fetchProCues(session.token, v.videoId)
        if (proCues.length > 0) cues = proCues
      } catch {
        /* 静默回退公共 R2 */
      }
    }
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
            {pageItems.map((v, i) => {
            // 免费档：ranked 排序前 FREE_DAILY_QUOTA 部可点，其余整卡锁定（点击弹付费墙）
            const locked = plan === 'free' && cur * PAGE_SIZE + i >= FREE_DAILY_QUOTA
            return (
            <div key={v.videoId} className={locked ? 'fav-card locked' : 'fav-card'}>
              <div className="fav-thumb">
                <img
                  src={v.thumbnail}
                  alt=""
                  onClick={() => openVideo(v)}
                />
                {v.level && <span className="thumb-badge thumb-badge-left">{v.level}</span>}
                <span className="thumb-badge thumb-badge-right">{fmtDuration(v.duration)}</span>
                {/* 推荐反馈入口（⑨）：悬停卡片显现，点开三项小菜单 */}
                <button
                  className="fb-menu-btn"
                  title="推荐反馈"
                  onClick={(e) => {
                    e.stopPropagation()
                    setFbMenuFor(fbMenuFor === v.videoId ? null : v.videoId)
                  }}
                >
                  <DotsIcon />
                </button>
                {fbMenuFor === v.videoId && (
                  <>
                    <div className="fb-menu-backdrop" onClick={() => setFbMenuFor(null)} />
                    <div className="fb-menu">
                      <button onClick={() => applyFeedback(markNotInterestedVideo(feedback, v.videoId))}>
                        不感兴趣这个视频
                      </button>
                      <button onClick={() => applyFeedback(markNotInterestedChannel(feedback, v.channelId))}>
                        不再推荐此频道
                      </button>
                      <button onClick={() => applyFeedback(markWatched(feedback, v.videoId))}>
                        标记已看完
                      </button>
                    </div>
                  </>
                )}
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
              {locked && (
                <button className="lock-mask" onClick={() => setPaywallOpen(true)}>
                  <LockIcon />
                  <span>升级解锁全部精选</span>
                </button>
              )}
            </div>
            )
          })}
          </div>
      )}
      </div>
        </div>
      </div>
      {paywallOpen && <PaywallModal onClose={() => setPaywallOpen(false)} />}
    </PageShell>
  )
}
