import { describe, expect, it, vi } from 'vitest'
import { loadAvailableCaptions } from '../src/shared/caption-loader'

const entry = { en: [{ start: 0, dur: 1, text: 'Hello' }], title: 'Favorite' }

describe('caption loading for any video entry point', () => {
  it('uses nonempty local captions without a network request', async () => {
    const readRemote = vi.fn()
    expect(await loadAvailableCaptions({ readCache: async () => entry, readRemote, isCurrent: () => true })).toBe(entry)
    expect(readRemote).not.toHaveBeenCalled()
  })

  it('loads Worker subtitles for an uncached favorite without requiring the curated page', async () => {
    const readRemote = vi.fn(async () => entry)
    expect(await loadAvailableCaptions({ readCache: async () => null, readRemote, isCurrent: () => true })).toBe(entry)
    expect(readRemote).toHaveBeenCalledTimes(1)
  })

  it('ignores an empty old cache entry and recovers from the Worker', async () => {
    expect(await loadAvailableCaptions({ readCache: async () => ({ ...entry, en: [] }), readRemote: async () => entry, isCurrent: () => true })).toBe(entry)
  })

  it('permits live extraction after cache failure and Worker errors or empty responses', async () => {
    for (const readRemote of [async () => { throw new Error('404/offline/403') }, async () => ({ ...entry, en: [] })]) {
      expect(await loadAvailableCaptions({ readCache: async () => { throw new Error('storage unavailable') }, readRemote, isCurrent: () => true })).toBeNull()
    }
  })

  it('does not start a remote request after navigating away during cache loading', async () => {
    let active = true
    const readRemote = vi.fn()
    expect(await loadAvailableCaptions({
      readCache: async () => { active = false; return entry }, readRemote, isCurrent: () => active
    })).toBeNull()
    expect(readRemote).not.toHaveBeenCalled()
  })

  it('discards a previous video response that resolves after navigation', async () => {
    let active = true
    expect(await loadAvailableCaptions({
      readCache: async () => null,
      readRemote: async () => { active = false; return entry },
      isCurrent: () => active
    })).toBeNull()
  })
})
