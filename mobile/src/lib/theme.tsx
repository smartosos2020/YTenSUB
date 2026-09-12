import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

/** 全局色板：各页面统一从这里取色，不再硬编码 */
export interface ThemeColors {
  bg: string
  bar: string
  card: string
  activeCard: string
  text: string
  subtext: string
  accent: string
  border: string
}

const DARK: ThemeColors = {
  bg: '#0B0C10',
  bar: '#10121A',
  card: '#16181F',
  activeCard: '#1C2230',
  text: '#E4E6EB',
  subtext: '#9AA0A6',
  accent: '#0A84FF',
  border: 'rgba(255,255,255,0.08)'
}

const LIGHT: ThemeColors = {
  bg: '#F2F4F7',
  bar: '#FFFFFF',
  card: '#FFFFFF',
  activeCard: '#EAF2FE',
  text: '#1E293B',
  subtext: '#64748B',
  accent: '#007AFF',
  border: 'rgba(0,0,0,0.08)'
}

interface ThemeCtx {
  dark: boolean
  colors: ThemeColors
  toggle: () => void
}

const THEME_KEY = 'ytensub:theme'

const Ctx = createContext<ThemeCtx>({ dark: true, colors: DARK, toggle: () => {} })

/** 日夜主题 Provider：默认夜间，选择持久化到 AsyncStorage */
export function ThemeProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [dark, setDark] = useState(true)

  useEffect(() => {
    void AsyncStorage.getItem(THEME_KEY)
      .then((v) => {
        if (v === 'light') setDark(false)
      })
      .catch(() => {})
  }, [])

  const toggle = useCallback((): void => {
    setDark((d) => {
      void AsyncStorage.setItem(THEME_KEY, d ? 'light' : 'dark').catch(() => {})
      return !d
    })
  }, [])

  const value = useMemo<ThemeCtx>(() => ({ dark, colors: dark ? DARK : LIGHT, toggle }), [dark, toggle])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useTheme(): ThemeCtx {
  return useContext(Ctx)
}
