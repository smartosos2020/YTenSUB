import { useEffect, useRef } from 'react'
import { HashRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { api, SETTINGS_CHANGED_EVENT } from './api'
import { applyTheme } from './theme'
import BrowsePage from './pages/BrowsePage'
import FavoritesPage from './pages/FavoritesPage'
import VocabularyPage from './pages/VocabularyPage'
import SettingsPage from './pages/SettingsPage'

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
  useEffect(() => {
    const syncTheme = (): void => void api.settingsGet().then((s) => applyTheme(s.theme))
    syncTheme()
    window.addEventListener(SETTINGS_CHANGED_EVENT, syncTheme)
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, syncTheme)
  }, [])

  return (
    <HashRouter>
      <div className="app">
        <nav className="sidebar">
          <div className="logo">YTenSUB</div>
          <NavLink to="/browse">浏览</NavLink>
          <NavLink to="/favorites">收藏</NavLink>
          <NavLink to="/vocabulary">生词本</NavLink>
          <NavLink to="/settings">设置</NavLink>
        </nav>
        <MainArea />
      </div>
    </HashRouter>
  )
}
