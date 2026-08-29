import { useEffect, useRef, useState } from 'react'
import { HashRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { api, SETTINGS_CHANGED_EVENT } from './api'
import { applyTheme } from './theme'
import { usePersistentState } from './hooks/usePersistentState'
import BrowsePage from './pages/BrowsePage'
import FavoritesPage from './pages/FavoritesPage'
import VocabularyPage from './pages/VocabularyPage'
import ReviewPage from './pages/ReviewPage'
import ShadowingPage from './pages/ShadowingPage'
import SettingsPage from './pages/SettingsPage'
import TitleBar from './components/TitleBar'
import PlayIcon from './components/icons/PlayIcon'
import StarOutlineIcon from './components/icons/StarOutlineIcon'
import BookIcon from './components/icons/BookIcon'
import RepeatIcon from './components/icons/RepeatIcon'
import GearIcon from './components/icons/GearIcon'
import UpdateIcon from './components/icons/UpdateIcon'

const NAV_ITEMS: { to: string; label: string; icon: JSX.Element }[] = [
  { to: '/browse', label: '浏览', icon: <PlayIcon /> },
  { to: '/favorites', label: '收藏', icon: <StarOutlineIcon /> },
  { to: '/vocabulary', label: '生词本', icon: <BookIcon /> },
  { to: '/review', label: '复习', icon: <RepeatIcon /> },
  { to: '/settings', label: '设置', icon: <GearIcon /> }
]

/**
 * Browse 页常驻挂载：切换菜单只是 display:none，webview 与播放进度保持不变。
 * 仅当带着新的视频参数（/browse?v=...）进入时才重挂载加载新视频。
 */
function MainArea(): JSX.Element {
  const location = useLocation()
  const onBrowse = location.pathname === '/' || location.pathname === '/browse'
  const browseKeyRef = useRef(onBrowse ? location.search : '')
  if (onBrowse && location.search && location.search !== browseKeyRef.current) {
    browseKeyRef.current = location.search
  }

  return (
    <main className="content">
      <div className="browse-holder" style={{ display: onBrowse ? 'flex' : 'none' }}>
        <BrowsePage key={browseKeyRef.current} />
      </div>
      {!onBrowse && (
        <Routes>
          <Route path="/favorites" element={<FavoritesPage />} />
          <Route path="/vocabulary" element={<VocabularyPage />} />
          <Route path="/review" element={<ReviewPage />} />
          <Route path="/shadowing" element={<ShadowingPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      )}
    </main>
  )
}

export default function App(): JSX.Element {
  const [collapsed, setCollapsed] = usePersistentState<boolean>('ytensub:nav-collapsed', false)
  // 字幕浮层总开关（标题栏，默认开）
  const [showCaptions, setShowCaptions] = useState(true)
  // 版本号与更新状态（electron-updater 事件）：下载中显示百分比，就绪/失败可点击
  const [appVersion, setAppVersion] = useState('')
  const [updateState, setUpdateState] = useState<
    'none' | 'downloading' | 'downloaded' | 'error'
  >('none')
  const [updatePct, setUpdatePct] = useState(0)

  useEffect(() => {
    const syncTheme = (): void =>
      void api.settingsGet().then((s) => {
        applyTheme(s.theme, s.accentColor)
        setShowCaptions(s.showCaptions ?? true)
      })
    syncTheme()
    // 跟随系统模式下，系统明暗变化时重新解析
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', syncTheme)
    window.addEventListener(SETTINGS_CHANGED_EVENT, syncTheme)
    return () => {
      mq.removeEventListener('change', syncTheme)
      window.removeEventListener(SETTINGS_CHANGED_EVENT, syncTheme)
    }
  }, [])

  useEffect(() => {
    void api.appVersion().then((v) => setAppVersion(String(v)))
    const offAvailable = api.onUpdateAvailable(() => {
      setUpdateState('downloading')
      setUpdatePct(0)
    })
    const offProgress = api.onUpdateProgress((p) => setUpdatePct(p))
    const offDownloaded = api.onUpdateDownloaded(() => setUpdateState('downloaded'))
    const offError = api.onUpdateError(() => setUpdateState('error'))
    return () => {
      offAvailable()
      offProgress()
      offDownloaded()
      offError()
    }
  }, [])

  return (
    <HashRouter>
      <div className="app">
        <TitleBar
          collapsed={collapsed}
          onToggle={() => setCollapsed(!collapsed)}
          showCaptions={showCaptions}
          onToggleCaptions={() => void api.settingsSet({ showCaptions: !showCaptions })}
        />
        <div className="app-body">
          <nav className={collapsed ? 'sidebar collapsed' : 'sidebar'}>
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} title={item.label}>
                <span className="nav-icon">{item.icon}</span>
                {!collapsed && <span className="nav-label">{item.label}</span>}
              </NavLink>
            ))}
            <div className="sidebar-foot">
              <span className="version">v{appVersion}</span>
              {updateState !== 'none' && (
                <>
                  <button
                    className={`update-btn ${updateState}`}
                    title={
                      updateState === 'downloaded'
                        ? '更新已就绪，点击重启安装'
                        : updateState === 'error'
                          ? '更新失败，点击打开发布页手动下载'
                          : `正在下载更新… ${updatePct}%（点击打开发布页手动下载）`
                    }
                    onClick={() => {
                      // 已下载 → 重启安装；其余状态（含失败）→ 打开发布页手动下载（网络临时方案）
                      if (updateState === 'downloaded') api.updateInstall()
                      else api.updateOpenReleases()
                    }}
                  >
                    <UpdateIcon />
                  </button>
                  {updateState === 'downloading' && (
                    <span className="update-pct">{updatePct}%</span>
                  )}
                </>
              )}
            </div>
          </nav>
          <MainArea />
        </div>
      </div>
    </HashRouter>
  )
}
