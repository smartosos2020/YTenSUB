export const PIPELINE_COUNTERS = ['candidates', 'eligible', 'captionAttempts', 'captionSucceeded', 'noCaptions', 'unavailable', 'captionFailures', 'channelFailures'] as const
export const CAPTION_ERRORS = ['no-captions', 'video-unavailable', 'rate-limited', 'network-error', 'http-error', 'player-error', 'invalid-response', 'empty-captions'] as const
export type CaptionError = typeof CAPTION_ERRORS[number]
export type PipelineStats = Record<typeof PIPELINE_COUNTERS[number], number> & { failureReasons: Partial<Record<CaptionError, number>> }
export interface PipelineMetrics {
  added: number
  refreshed: number
  repaired: number
  total: number
  stats: PipelineStats
}
export interface PipelineSummary extends PipelineMetrics {
  state: 'success' | 'partial' | 'failed'
  message: string
}
export function emptyPipelineStats(): PipelineStats {
  return { candidates: 0, eligible: 0, captionAttempts: 0, captionSucceeded: 0, noCaptions: 0, unavailable: 0, captionFailures: 0, channelFailures: 0, failureReasons: {} }
}
/** Keep only bounded, known counters when accepting reports from a runner. */
export function readPipelineMetrics(value: Record<string, unknown>): Partial<PipelineMetrics> {
  const out: Partial<PipelineMetrics> = {}
  const counter = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
  for (const key of ['added', 'refreshed', 'repaired', 'total'] as const) if (counter(value[key])) out[key] = value[key]
  if (value.stats && typeof value.stats === 'object' && !Array.isArray(value.stats)) {
    const input = value.stats as Record<string, unknown>
    const stats = emptyPipelineStats()
    for (const key of PIPELINE_COUNTERS) if (counter(input[key])) stats[key] = input[key]
    if (input.failureReasons && typeof input.failureReasons === 'object') {
      const reasons = input.failureReasons as Record<string, unknown>
      for (const key of CAPTION_ERRORS) if (counter(reasons[key])) stats.failureReasons[key] = reasons[key]
    }
    out.stats = stats
  }
  return out
}
