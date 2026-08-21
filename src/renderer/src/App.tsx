import { useEffect, useRef, useState } from 'react'
import { HashRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { api, SETTINGS_CHANGED_EVENT } from './api'
import { applyTheme } from './theme'
import BrowsePage from './pages/BrowsePage'
import FavoritesPage from './pages/FavoritesPage'
import VocabularyPage from './pages/VocabularyPage'
import SettingsPage from './pages/SettingsPage'
import TitleBar from './components/TitleBar'

const NAV_COLLAPSED_KEY = 'ytensub:nav-collapsed'

/** 菜单收缩状态持久化在 localStorage（纯界面偏好，不进设置文件） */
function readNavCollapsed(): boolean {
  try {
    return localStorage.getItem(NAV_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

interface IconProps {
  children: React.ReactNode
}

function NavIcon({ children }: IconProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  )
}

const NAV_ITEMS: { to: string; label: string; icon: JSX.Element }[] = [
  {
    to: '/browse',
    label: '浏览',
    icon: (
      <NavIcon>
        <circle cx="12" cy="12" r="9" />
        <path d="m10 8 6 4-6 4z" />
      </NavIcon>
    )
  },
  {
    to: '/favorites',
    label: '收藏',
    icon: (
      <NavIcon>
        <path d="m12 2 3.1 6.3 6.9.8-5.1 4.7 1.4 6.8-6.3-3.4-6.3 3.4 1.4-6.8L2 9.1l6.9-.8z" />
      </NavIcon>
    )
  },
  {
    to: '/vocabulary',
    label: '生词本',
    icon: (
      <NavIcon>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </NavIcon>
    )
  },
  {
    to: '/settings',
    label: '设置',
    icon: (
      <NavIcon>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </NavIcon>
    )
  }
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
  const [collapsed, setCollapsed] = useState<boolean>(readNavCollapsed)

  useEffect(() => {
    const syncTheme = (): void => void api.settingsGet().then((s) => applyTheme(s.theme))
    syncTheme()
    window.addEventListener(SETTINGS_CHANGED_EVENT, syncTheme)
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, syncTheme)
  }, [])

  const toggleCollapsed = (): void => {
    const next = !collapsed
    setCollapsed(next)
    try {
      localStorage.setItem(NAV_COLLAPSED_KEY, next ? '1' : '0')
    } catch {
      /* localStorage 不可用时静默 */
    }
  }

  return (
    <HashRouter>
      <div className="app">
        <TitleBar collapsed={collapsed} onToggle={toggleCollapsed} />
        <div className="app-body">
          <nav className={collapsed ? 'sidebar collapsed' : 'sidebar'}>
            {!collapsed && <div className="logo">YTenSUB</div>}
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
