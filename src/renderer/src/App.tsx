import { useEffect, useRef } from 'react'
import { HashRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { api, SETTINGS_CHANGED_EVENT } from './api'
import { applyTheme } from './theme'
import { usePersistentState } from './hooks/usePersistentState'
import BrowsePage from './pages/BrowsePage'
import FavoritesPage from './pages/FavoritesPage'
import VocabularyPage from './pages/VocabularyPage'
import SettingsPage from './pages/SettingsPage'
import TitleBar from './components/TitleBar'
import PlayIcon from './components/icons/PlayIcon'
import StarOutlineIcon from './components/icons/StarOutlineIcon'
import BookIcon from './components/icons/BookIcon'
import GearIcon from './components/icons/GearIcon'

const NAV_ITEMS: { to: string; label: string; icon: JSX.Element }[] = [
  { to: '/browse', label: '浏览', icon: <PlayIcon /> },
  { to: '/favorites', label: '收藏', icon: <StarOutlineIcon /> },
  { to: '/vocabulary', label: '生词本', icon: <BookIcon /> },
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
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      )}
    </main>
  )
}

export default function App(): JSX.Element {
  const [collapsed, setCollapsed] = usePersistentState<boolean>('ytensub:nav-collapsed', false)

  useEffect(() => {
    const syncTheme = (): void => void api.settingsGet().then((s) => applyTheme(s.theme))
    syncTheme()
    window.addEventListener(SETTINGS_CHANGED_EVENT, syncTheme)
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, syncTheme)
  }, [])

  return (
    <HashRouter>
      <div className="app">
        <TitleBar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
        <div className="app-body">
          <nav className={collapsed ? 'sidebar collapsed' : 'sidebar'}>
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} title={item.label}>
                <span className="nav-icon">{item.icon}</span>
                {!collapsed && <span className="nav-label">{item.label}</span>}
              </NavLink>
            ))}
          </nav>
          <MainArea />
        </div>
      </div>
    </HashRouter>
  )
}
