/** 秒 → mm:ss / h:mm:ss；空值返回 null */
export function fmtDuration(s?: number): string | null {
  if (!s) return null
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`
}

/** 无头像兜底：名字首字母 + 按名字哈希的稳定色相 */
export function hueOf(s: string): number {
  let h = 0
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}
