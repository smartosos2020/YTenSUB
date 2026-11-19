export interface Cue {
  start: number
  dur: number
  text: string
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** 解析 YouTube timedtext json3 格式为字幕数组 */
export function parseJson3Captions(data: unknown): Cue[] {
  const events = (data as { events?: unknown[] })?.events
  if (!Array.isArray(events)) return []
  const cues: Cue[] = []
  for (const raw of events) {
    const e = raw as {
      tStartMs?: number
      dDurationMs?: number
      segs?: { utf8?: string }[]
    }
    if (!e.segs) continue
    const text = e.segs
      .map((s) => s.utf8 ?? '')
      .join('')
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!text) continue
    cues.push({
      start: (e.tStartMs ?? 0) / 1000,
      dur: (e.dDurationMs ?? 0) / 1000,
      text
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

function parseClock(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  const parts = normalized.split(':')
  if (parts.length < 2 || parts.length > 3) return null
  const seconds = Number(parts.pop())
  const minutes = Number(parts.pop())
  const hours = parts.length ? Number(parts.pop()) : 0
  if (![hours, minutes, seconds].every(Number.isFinite)) return null
  return hours * 3600 + minutes * 60 + seconds
}

function cleanExternalText(value: string): string {
  return decodeXmlEntities(
    value
      .replace(/\{\\[^}]*\}/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\\[Nn]/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim()
}

/** 解析常见 SRT / WebVTT 字幕。 */
export function parseSrtOrVtt(text: string): Cue[] {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const blocks = normalized.split(/\n{2,}/)
  const cues: Cue[] = []
  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trimEnd())
    const timingIndex = lines.findIndex((line) => line.includes('-->'))
    if (timingIndex < 0 || /^NOTE\b/i.test(lines[0] ?? '')) continue
    const match = /^\s*([^\s]+)\s*-->\s*([^\s]+)/.exec(lines[timingIndex])
    if (!match) continue
    const start = parseClock(match[1])
    const end = parseClock(match[2])
    if (start === null || end === null || end < start) continue
    const cueText = cleanExternalText(lines.slice(timingIndex + 1).join(' '))
    if (!cueText) continue
    cues.push({ start, dur: Math.max(0, end - start), text: cueText })
  }
  return cues.sort((a, b) => a.start - b.start)
}

/** 解析 ASS/SSA 的 Dialogue 行；样式标记会被剥除，只保留学习所需文本。 */
export function parseAss(text: string): Cue[] {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')
  let inEvents = false
  let format: string[] = []
  const cues: Cue[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (/^\[Events\]$/i.test(line)) {
      inEvents = true
      continue
    }
    if (/^\[/.test(line) && !/^\[Events\]$/i.test(line)) {
      inEvents = false
      continue
    }
    if (!inEvents) continue
    if (/^Format\s*:/i.test(line)) {
      format = line
        .replace(/^Format\s*:/i, '')
        .split(',')
        .map((part) => part.trim().toLowerCase())
      continue
    }
    if (!/^Dialogue\s*:/i.test(line)) continue
    const body = line.replace(/^Dialogue\s*:/i, '').trim()
    const expected = Math.max(1, format.length)
    const parts = body.split(',')
    if (parts.length < expected) continue
    const fixed = parts.slice(0, expected - 1)
    fixed.push(parts.slice(expected - 1).join(','))
    const startIndex = format.indexOf('start')
    const endIndex = format.indexOf('end')
    const textIndex = format.indexOf('text')
    if (startIndex < 0 || endIndex < 0 || textIndex < 0) continue
    const start = parseClock(fixed[startIndex])
    const end = parseClock(fixed[endIndex])
    if (start === null || end === null || end < start) continue
    const cueText = cleanExternalText(fixed[textIndex])
    if (!cueText) continue
    cues.push({ start, dur: Math.max(0, end - start), text: cueText })
  }
  return cues.sort((a, b) => a.start - b.start)
}

/** 根据内容自动判别并解析本地/在线下载的 SRT、VTT、ASS/SSA 字幕。 */
export function parseExternalSubtitle(text: string | null | undefined): Cue[] {
  if (!text?.trim()) return []
  const trimmed = text.trimStart()
  if (/\[Script Info\]|\[Events\]/i.test(trimmed)) return parseAss(text)
  return parseSrtOrVtt(text)
}

/** 找到当前播放时间对应的字幕下标，没有则返回 -1 */
export function findActiveCueIndex(cues: Cue[], time: number): number {
  // 字幕按 start 升序；取最后一个 start <= time 且未明显过期的 cue
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
  if (ans === -1) return -1
  const cue = cues[ans]
  // 允许 0.5s 的尾部宽限，避免两句之间闪烁
  return time <= cue.start + Math.max(cue.dur, 0) + 0.5 ? ans : -1
}

function srtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000))
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  return (
    `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:` +
    `${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`
  )
}

/** 导出双语 SRT：英文行 + （可选的）中文行；时长缺失按 0.4s 计 */
export function toBilingualSrt(cues: Cue[], zhLines: (string | null)[] | null): string {
  return (
    cues
      .map((c, i) => {
        const lines = [
          String(i + 1),
          `${srtTime(c.start)} --> ${srtTime(c.start + Math.max(c.dur, 0.4))}`,
          c.text
        ]
        const zh = zhLines?.[i]
        if (zh) lines.push(zh)
        return lines.join('\n')
      })
      .join('\n\n') + '\n'
  )
}

/**
 * 把中文字幕按时间重叠对齐到英文字幕：对每条英文 cue，收集与其时间区间
 * 相交的中文 cue 文本并顺序拼接，结果与 enCues 等长对齐，无重叠为 null。
 * 时长缺失的 cue 按 0.4s 计，避免零长区间永远不相交。
 */
export function alignCuesToEn(enCues: Cue[], zhCues: Cue[]): (string | null)[] {
  const zs = zhCues.map((c) => ({
    s: c.start,
    e: c.start + Math.max(c.dur, 0.4),
    text: c.text
  }))
  return enCues.map((en) => {
    const s = en.start
    const e = en.start + Math.max(en.dur, 0.4)
    const parts: string[] = []
    for (const z of zs) {
      if (z.e <= s) continue
      if (z.s >= e) break // 中文字幕按 start 升序，之后的不会再相交
      parts.push(z.text)
    }
    return parts.length ? parts.join(' ') : null
  })
}
