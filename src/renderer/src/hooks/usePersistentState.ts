import { useState } from 'react'

/**
 * 持久化到 localStorage 的 useState（纯界面偏好，不进设置文件）。
 * boolean 存 '1'/'0'，number/string 直接存；validate 用于读取时校验取值范围。
 */
export function usePersistentState<T extends string | number | boolean>(
  key: string,
  defaultValue: T,
  validate?: (v: T) => boolean
): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw === null) return defaultValue
      const v = (
        typeof defaultValue === 'boolean'
          ? raw === '1'
          : typeof defaultValue === 'number'
            ? Number(raw)
            : raw
      ) as T
      return validate && !validate(v) ? defaultValue : v
    } catch {
      return defaultValue
    }
  })

  const set = (v: T): void => {
    setValue(v)
    try {
      localStorage.setItem(key, typeof v === 'boolean' ? (v ? '1' : '0') : String(v))
    } catch {
      /* localStorage 不可用时静默 */
    }
  }

  return [value, set]
}
