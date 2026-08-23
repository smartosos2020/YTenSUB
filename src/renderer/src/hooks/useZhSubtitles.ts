import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { alignCuesToEn, Cue } from '../../../shared/captions'

export interface ZhSubtitlesState {
  showZh: boolean
  setShowZh: (v: boolean) => void
  /** 与 cues 等长对齐的中文字幕；null 表示尚未就绪 */
  zhLines: (string | null)[] | null
  zhLoading: boolean
  toggleZh: (v: boolean) => void
  resetZh: () => void
  loadZhNative: (parsed: Cue[], zhParsed: Cue[]) => void
  /** 是否存在视频自带/机翻中文轨（偏移调整仅对其有意义） */
  hasZhNative: boolean
  /** 中文字幕时间偏移（秒，正=延后） */
  zhOffset: number
  adjustZhOffset: (delta: number) => void
}

/**
 * 中文字幕：showZh 来自设置（默认关）；zhRaw 为视频自带/YouTube 机翻轨原文，
 * 叠加 zhOffset 后按时间轴对齐为 zhNative；zhTrans 为 Google 批量翻译结果
 * （zhNative 为空时才翻译）。
 */
export function useZhSubtitles(cues: Cue[]): ZhSubtitlesState {
  const [showZh, setShowZh] = useState(false)
  const [zhRaw, setZhRaw] = useState<Cue[] | null>(null)
  const [zhOffset, setZhOffset] = useState(0)
  const [zhTrans, setZhTrans] = useState<(string | null)[] | null>(null)
  const [zhLoading, setZhLoading] = useState(false)
  // 翻译任务序号：换视频或重开开关时作废旧任务
  const zhJobRef = useRef(0)

  // 中文轨按时间轴对齐到英文字幕；偏移改变时重算
  const zhNative = useMemo(() => {
    if (!zhRaw || zhRaw.length === 0 || cues.length === 0) return null
    const shifted = zhRaw.map((c) => ({ ...c, start: c.start + zhOffset }))
    return alignCuesToEn(cues, shifted)
  }, [zhRaw, cues, zhOffset])

  /** 中文字幕开关：写入设置持久化（默认关闭） */
  const toggleZh = useCallback((v: boolean): void => {
    setShowZh(v)
    void api.settingsSet({ showZhSubtitle: v })
  }, [])

  /** 切换视频或提取失败时重置中文字幕状态，并作废进行中的翻译任务 */
  const resetZh = useCallback((): void => {
    zhJobRef.current++
    setZhRaw(null)
    setZhTrans(null)
    setZhLoading(false)
    setZhOffset(0)
  }, [])

  /** 提取成功：保留中文轨原文（视频自带或 YouTube 机翻 tlang），对齐由 zhNative 派生 */
  const loadZhNative = useCallback((_parsed: Cue[], zhParsed: Cue[]): void => {
    zhJobRef.current++
    setZhRaw(zhParsed.length ? zhParsed : null)
    setZhTrans(null)
    setZhLoading(false)
    setZhOffset(0)
  }, [])

  /** 中文轨时间微调：±0.5s 步进，钳制在 ±5s */
  const adjustZhOffset = useCallback((delta: number): void => {
    setZhOffset((o) => Math.min(5, Math.max(-5, Math.round((o + delta) * 10) / 10)))
  }, [])

  // 视频没有自己的中文字幕（zhNative 为空）时，打开开关后用整句批量翻译代替，分块渐进显示
  useEffect(() => {
    if (!showZh || cues.length === 0 || zhNative || zhTrans) return
    const job = ++zhJobRef.current
    setZhLoading(true)
    const CHUNK = 30
    const acc: (string | null)[] = new Array(cues.length).fill(null)
    void (async () => {
      try {
        for (let i = 0; i < cues.length; i += CHUNK) {
          const part = await api.translateZhBatch(cues.slice(i, i + CHUNK).map((c) => c.text))
          if (zhJobRef.current !== job) return
          for (let j = 0; j < part.length; j++) acc[i + j] = part[j]
          setZhTrans([...acc])
        }
      } finally {
        if (zhJobRef.current === job) setZhLoading(false)
      }
    })()
  }, [showZh, cues, zhNative, zhTrans])

  return {
    showZh,
    setShowZh,
    zhLines: zhNative ?? zhTrans,
    zhLoading,
    toggleZh,
    resetZh,
    loadZhNative,
    hasZhNative: !!zhRaw && zhRaw.length > 0,
    zhOffset,
    adjustZhOffset
  }
}
