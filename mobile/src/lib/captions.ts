/**
 * 与桌面端 src/shared/captions.ts 同源（MVP 先拷贝，后续抽公共包）。
 * 解析 YouTube timedtext 字幕：json3 / srv XML 自动判别。
 */
export interface Cue {
  start: number
  dur: number
  text: string
}

/** HTML/XML 实体解码（字幕里常见的几个） */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
}

/** 解析 YouTube timedtext json3 格式为字幕数组 */
export function parseJson3Captions(data: unknown): Cue[] {
  const events = (data as { events?: unknown[] })?.events
  if (!Array.isArray(events)) return []
  const cues: Cue[] = []
  for (const ev of events) {
    const e = ev as { tStartMs?: number; dDurationMs?: number; segs?: { utf8?: string }[] }
    if (!e.segs || e.tStartMs === undefined) continue
    const text = e.segs
      .map((s) => s.utf8 ?? '')
      .join('')
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!text) continue
    cues.push({
      start: e.tStartMs / 1000,
      dur: (e.dDurationMs ?? 0) / 1000,
      text: decodeXmlEntities(text)
    })
  }
  return cues
}

/** 解析 srv1/srv2 XML 字幕（<p t="毫秒" d="毫秒">文本</p>，内部 <s> 等标签剥掉） */
export function parseSrvXml(xml: string): Cue[] {
  const cues: Cue[] = []
  const reP = /<p\b([^>]*)>([\s\S]*?)<\/p>/g
  let m: RegExpExecArray | null
  while ((m = reP.exec(xml))) {
    const attrs = m[1]
    const t = /\bt="(\d+)"/.exec(attrs)
    if (!t) continue
    const d = /\bd="(\d+)"/.exec(attrs)
    const text = decodeXmlEntities(m[2].replace(/<[^>]+>/g, ''))
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!text) continue
    cues.push({ start: Number(t[1]) / 1000, dur: Number(d?.[1] ?? 0) / 1000, text })
  }
  return cues
}

/** 根据内容自动判别 json3 / XML 并解析 */
export function parseCaptionText(text: string | null | undefined): Cue[] {
  if (!text) return []
  const trimmed = text.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('{')) {
    try {
      return parseJson3Captions(JSON.parse(trimmed))
    } catch {
      return []
    }
  }
  if (trimmed.startsWith('<')) return parseSrvXml(trimmed)
  return []
}

/** 找到当前播放时间对应的字幕下标，没有则返回 -1 */
export function findActiveCueIndex(cues: Cue[], time: number): number {
  let lo = 0
  let hi = cues.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (cues[mid].start <= time) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  // 防字幕已过期太久（大段无字幕空白时不残留显示）
  if (ans >= 0 && time - (cues[ans].start + cues[ans].dur) > 5) return -1
  return ans
}
