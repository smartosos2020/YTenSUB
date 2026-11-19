import { describe, expect, it } from 'vitest'
import { audioSchedulePoint } from '../src/renderer/src/hooks/useLocalAudioFallback'

describe('audioSchedulePoint', () => {
  it('把未来的音频块安排到对应的 AudioContext 时间', () => {
    expect(audioSchedulePoint({
      bufferTimestamp: 12,
      bufferDuration: 1,
      mediaAnchor: 10,
      contextAnchor: 100,
      contextNow: 100.2,
      playbackRate: 1
    })).toEqual({ contextStart: 102, offset: 0 })
  })

  it('调度已经开始的音频块时从块内偏移处继续', () => {
    expect(audioSchedulePoint({
      bufferTimestamp: 10,
      bufferDuration: 2,
      mediaAnchor: 10,
      contextAnchor: 100,
      contextNow: 100.75,
      playbackRate: 1
    })).toEqual({ contextStart: 100.75, offset: 0.75 })
  })

  it('倍速播放时按媒体时间折算到 Context 时间', () => {
    expect(audioSchedulePoint({
      bufferTimestamp: 14,
      bufferDuration: 1,
      mediaAnchor: 10,
      contextAnchor: 20,
      contextNow: 20,
      playbackRate: 2
    })).toEqual({ contextStart: 22, offset: 0 })
  })

  it('已经完整错过的音频块不再调度', () => {
    expect(audioSchedulePoint({
      bufferTimestamp: 10,
      bufferDuration: 0.5,
      mediaAnchor: 10,
      contextAnchor: 100,
      contextNow: 101,
      playbackRate: 1
    })).toBeNull()
  })
})
