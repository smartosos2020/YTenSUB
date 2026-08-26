import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { createTheme, MantineProvider } from '@mantine/core'
import '@mantine/core/styles.css'
import App from './App'
import { api, SETTINGS_CHANGED_EVENT } from './api'
import { resolveTheme } from './theme'
import './styles.css'

// Mantine 主题：主色用应用 accent 绿（夜间荧光绿），字体跟随界面等宽
const mantineTheme = createTheme({
  primaryColor: 'ytGreen',
  colors: {
    ytGreen: [
      '#e6fff5',
      '#d0fdea',
      '#a9fbd6',
      '#7ff9c1',
      '#5df7ad',
      '#00ff9f',
      '#00e68f',
      '#00cc7e',
      '#00b36d',
      '#00995e'
    ]
  },
  fontFamily:
    "'Cascadia Code', 'JetBrains Mono', Consolas, 'Courier New', 'Microsoft YaHei', monospace",
  defaultRadius: 'md'
})

/** 应用主题（夜/日/跟随系统）同步到 Mantine 的 colorScheme */
function Root(): JSX.Element {
  const [scheme, setScheme] = useState<'dark' | 'light'>('dark')
  useEffect(() => {
    const sync = (): void => {
      // 应用 night/day → Mantine dark/light
      void api.settingsGet().then((s) =>
        setScheme(resolveTheme(s.theme) === 'night' ? 'dark' : 'light')
      )
    }
    sync()
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', sync)
    window.addEventListener(SETTINGS_CHANGED_EVENT, sync)
    return () => {
      mq.removeEventListener('change', sync)
      window.removeEventListener(SETTINGS_CHANGED_EVENT, sync)
    }
  }, [])
  return (
    <MantineProvider theme={mantineTheme} forceColorScheme={scheme}>
      <App />
    </MantineProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)
