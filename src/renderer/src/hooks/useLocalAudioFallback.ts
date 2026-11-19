import { RefObject, useEffect, useState } from 'react'
import { ALL_FORMATS, AudioBufferSink, Input, UrlSource } from 'mediabunny'

export type LocalAudioState =
  | { kind: 'idle'; label: string }
  | { kind: 'checking'; label: string }
  | { kind: 'native'; label: string; codec: string }
  | { kind: 'fallback'; label: string; codec: string }
  | { kind: 'error'; label: string; codec?: string; detail: string }

const FALLBACK_CODECS = new Set(['dts', 'ac3', 'eac3'])

function codecLabel(codec: string): string {
  return ({ dts: 'DTS', ac3: 'AC3', eac3: 'E-AC3', aac: 'AAC', opus: 'Opus' } as Record<string, string>)[codec]
    ?? codec.toUpperCase()
}

/**
 * 将媒体时间轴上的音频块映射到 AudioContext 时间轴。
 * 返回 contextStart（何时播放）与 offset（块内跳过多少秒）。
 */
export function audioSchedulePoint(options: {
  bufferTimestamp: number
  bufferDuration: number
  mediaAnchor: number
  contextAnchor: number
  contextNow: number
  playbackRate: number
}): { contextStart: number; offset: number } | null {
  const rate = Math.max(0.01, options.playbackRate)
  const idealStart = options.contextAnchor + (options.bufferTimestamp - options.mediaAnchor) / rate
  const offset = Math.max(0, (options.contextNow - idealStart) * rate)
  if (offset >= options.bufferDuration) return null
  return { contextStart: Math.max(options.contextNow, idealStart), offset }
}

/**
 * 原生 Electron 不支持 DTS/AC3/E-AC3 时，仅解码音轨并与原生 video 画面同步。
 * 视频本身继续走浏览器硬件解码，不转码，也不产生临时媒体文件。
 */
export function useLocalAudioFallback(
  videoRef: RefObject<HTMLVideoElement>,
  mediaUrl: string | null,
  enabled = true
): LocalAudioState {
  const [state, setState] = useState<LocalAudioState>({ kind: 'idle', label: '' })

  useEffect(() => {
    const video = videoRef.current
    if (!enabled || !mediaUrl || !video) {
      setState({ kind: 'idle', label: '' })
      return
    }

    let disposed = false
    let input: Input<UrlSource> | null = null
    let context: AudioContext | null = null
    let gain: GainNode | null = null
    let sink: AudioBufferSink | null = null
    let iterator: ReturnType<AudioBufferSink['buffers']> | null = null
    let job = 0
    let anchorMedia = 0
    let anchorContext = 0
    let anchorRate = 1
    let driftTimer: number | null = null
    const queuedNodes = new Set<AudioBufferSourceNode>()

    const stopNodes = (): void => {
      job++
      void iterator?.return()
      iterator = null
      for (const node of queuedNodes) {
        try { node.stop() } catch { /* node may already have ended */ }
      }
      queuedNodes.clear()
    }

    const syncVolume = (): void => {
      if (!gain || !context) return
      gain.gain.setValueAtTime(video.muted ? 0 : video.volume, context.currentTime)
    }

    const scheduleAudio = async (currentJob: number): Promise<void> => {
      if (!sink || !context || !gain || !iterator) return
      const currentIterator = iterator
      try {
        for await (const { buffer, timestamp, duration } of currentIterator) {
          if (disposed || currentJob !== job || video.paused || video.ended) break

          // 最多预排 1.5 秒，避免暂停或跳转时留下大量待播放节点。
          while (timestamp - video.currentTime > 1.5) {
            if (disposed || currentJob !== job || video.paused) return
            await new Promise((resolve) => window.setTimeout(resolve, 60))
          }

          const point = audioSchedulePoint({
            bufferTimestamp: timestamp,
            bufferDuration: duration,
            mediaAnchor: anchorMedia,
            contextAnchor: anchorContext,
            contextNow: context.currentTime,
            playbackRate: anchorRate
          })
          if (!point) continue

          const node = context.createBufferSource()
          node.buffer = buffer
          node.playbackRate.setValueAtTime(anchorRate, context.currentTime)
          node.connect(gain)
          node.start(point.contextStart, point.offset)
          queuedNodes.add(node)
          node.onended = () => queuedNodes.delete(node)
        }
      } catch (error) {
        if (!disposed && currentJob === job) {
          setState({
            kind: 'error',
            label: '兼容音频失败',
            detail: error instanceof Error ? error.message : String(error)
          })
        }
      }
    }

    const startAudio = async (): Promise<void> => {
      if (!context || !sink || disposed || video.paused || video.ended) return
      stopNodes()
      const currentJob = job
      try {
        if (context.state === 'suspended') await context.resume()
        if (disposed || currentJob !== job || video.paused) return
        anchorMedia = video.currentTime
        anchorContext = context.currentTime + 0.04
        anchorRate = Math.max(0.01, video.playbackRate)
        iterator = sink.buffers(Math.max(0, anchorMedia - 0.2))
        void scheduleAudio(currentJob)
      } catch (error) {
        if (!disposed) {
          setState({
            kind: 'error',
            label: '兼容音频启动失败',
            detail: error instanceof Error ? error.message : String(error)
          })
        }
      }
    }

    const pauseAudio = (): void => {
      stopNodes()
      void context?.suspend()
    }
    const restartAudio = (): void => { if (!video.paused) void startAudio() }

    let initialization: Promise<void> | null = null

    const initialize = async (): Promise<void> => {
      setState({ kind: 'checking', label: '检查音轨…' })
      try {
        input = new Input({
          source: new UrlSource(mediaUrl, {
            maxCacheSize: 12 * 1024 * 1024,
            parallelism: 2,
            handleUnhandledError: () => {}
          }),
          formats: ALL_FORMATS
        })
        const track = await input.getPrimaryAudioTrack()
        if (disposed) return
        if (!track) {
          setState({ kind: 'error', label: '未发现音轨', detail: '视频文件没有可识别的音轨' })
          input.dispose()
          input = null
          return
        }

        const codec = await track.getCodec()
        if (disposed) return
        if (!codec || !FALLBACK_CODECS.has(codec)) {
          setState({
            kind: 'native',
            label: codec ? `${codecLabel(codec)} 原生音频` : '原生音频',
            codec: codec ?? 'unknown'
          })
          input.dispose()
          input = null
          return
        }

        // 解码器动态加载，普通视频不会承担 WASM 下载与初始化成本。
        if (codec === 'dts') {
          const { registerDtsDecoder } = await import('@mediabunny/dts')
          registerDtsDecoder()
        } else {
          const { registerAc3Decoder } = await import('@mediabunny/ac3')
          registerAc3Decoder()
        }
        if (disposed) return
        if (!(await track.canDecode())) throw new Error(`${codecLabel(codec)} 解码器不可用`)

        const sampleRate = await track.getSampleRate()
        context = new AudioContext(sampleRate ? { sampleRate } : undefined)
        gain = context.createGain()
        gain.connect(context.destination)
        syncVolume()
        sink = new AudioBufferSink(track)
        setState({
          kind: 'fallback',
          label: `${codecLabel(codec)} 兼容音频`,
          codec
        })

        video.addEventListener('playing', restartAudio)
        video.addEventListener('pause', pauseAudio)
        video.addEventListener('seeking', pauseAudio)
        video.addEventListener('seeked', restartAudio)
        video.addEventListener('ratechange', restartAudio)
        video.addEventListener('waiting', pauseAudio)
        video.addEventListener('ended', pauseAudio)
        video.addEventListener('volumechange', syncVolume)
        driftTimer = window.setInterval(() => {
          if (!context || video.paused || video.seeking || context.state !== 'running') return
          const expected = anchorMedia + (context.currentTime - anchorContext) * anchorRate
          if (Math.abs(video.currentTime - expected) > 0.18) void startAudio()
        }, 1000)
        if (!video.paused) void startAudio()
      } catch (error) {
        if (!disposed) {
          setState({
            kind: 'error',
            label: '音轨检查失败',
            detail: error instanceof Error ? error.message : String(error)
          })
        }
        input?.dispose()
        input = null
      }
    }

    // Do not inspect multi-gigabyte MKV files as soon as they are selected.
    // Chromium and Mediabunny should start reading only after the user presses play.
    const initializeOnPlay = (): void => {
      initialization ??= initialize()
    }
    video.addEventListener('play', initializeOnPlay)
    if (!video.paused) initializeOnPlay()

    return () => {
      disposed = true
      stopNodes()
      video.removeEventListener('play', initializeOnPlay)
      video.removeEventListener('playing', restartAudio)
      video.removeEventListener('pause', pauseAudio)
      video.removeEventListener('seeking', pauseAudio)
      video.removeEventListener('seeked', restartAudio)
      video.removeEventListener('ratechange', restartAudio)
      video.removeEventListener('waiting', pauseAudio)
      video.removeEventListener('ended', pauseAudio)
      video.removeEventListener('volumechange', syncVolume)
      if (driftTimer !== null) window.clearInterval(driftTimer)
      input?.dispose()
      void context?.close()
    }
  }, [enabled, mediaUrl, videoRef])

  return state
}
