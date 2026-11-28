import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadClientConfig, loadReleaseConfig, resolveClientConfig } from '../scripts/client-config.mjs'

const directories: string[] = []
function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ytensub-client-config-'))
  directories.push(root)
  return root
}
afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe('Client service isolation', () => {
  it('defaults both clients to localhost, with updates and installer links disabled', async () => {
    vi.stubEnv('EXPO_PUBLIC_YTENSUB_API_URL', '')
    vi.stubEnv('YTENSUB_UPDATE_URL', '')
    vi.resetModules()
    const api = await import('../src/shared/auth-api')
    const { CURATED_INDEX_URL } = await import('../src/shared/curated-config')
    const { UPDATE_URL, INSTALLER_URL } = await import('../src/main/update-config')
    const fetchFn = vi.fn(async (url: string) => Response.json({ ok: !!url }))
    await api.requestCode('learner@example.com', fetchFn)
    expect(fetchFn.mock.calls[0][0]).toBe('http://127.0.0.1:8787/auth/code')
    expect(CURATED_INDEX_URL).toBe('http://127.0.0.1:8787/content/index.json')
    expect(UPDATE_URL).toBe('')
    expect(INSTALLER_URL).toBe('')
  })

  it('does not load private release settings or pipeline AUTH_API_URL during normal builds', () => {
    const root = tempRoot()
    vi.stubEnv('YTENSUB_API_URL', '')
    vi.stubEnv('YTENSUB_UPDATE_URL', '')
    fs.writeFileSync(path.join(root, '.env'), 'AUTH_API_URL=https://pipeline.example\nADMIN_TOKEN=private-token\n')
    fs.writeFileSync(path.join(root, '.env.release.local'), 'YTENSUB_API_URL=https://official.example\nYTENSUB_UPDATE_URL=https://download.example/releases\n')
    expect(loadClientConfig('production', root)).toEqual({ apiUrl: 'http://127.0.0.1:8787', updateUrl: '' })
    expect(loadReleaseConfig(root, {})).toEqual({ apiUrl: 'https://official.example', updateUrl: 'https://download.example/releases' })
  })

  it('requires explicit complete HTTPS settings before an official build can start', () => {
    const root = tempRoot()
    expect(() => loadReleaseConfig(root, {})).toThrow('requires')
    expect(() => loadReleaseConfig(root, { YTENSUB_API_URL: 'https://api.example' })).toThrow('requires')
    expect(() => loadReleaseConfig(root, {
      YTENSUB_API_URL: 'http://127.0.0.1:8787', YTENSUB_UPDATE_URL: 'https://download.example/releases'
    })).toThrow('HTTPS')
  })

  it('supports self-hosted API origins and an independently configured update service', async () => {
    expect(resolveClientConfig({ YTENSUB_API_URL: 'https://self.example/api/' })).toEqual({ apiUrl: 'https://self.example/api', updateUrl: '' })
    vi.stubEnv('EXPO_PUBLIC_YTENSUB_API_URL', 'https://self.example/api/')
    vi.stubEnv('YTENSUB_UPDATE_URL', 'https://self.example/releases/')
    vi.resetModules()
    expect((await import('../src/shared/api-config')).AUTH_API_URL).toBe('https://self.example/api')
    expect((await import('../src/main/update-config')).INSTALLER_URL).toBe('https://self.example/releases/YTenSUB-Setup-latest.exe')
  })

  it.each(['file:///tmp/config', 'https://user:pass@api.example', 'https://api.example?token=secret', 'https://api.example/#fragment'])('rejects an unsafe build URL: %s', value => {
    expect(() => resolveClientConfig({ YTENSUB_API_URL: value })).toThrow()
    expect(() => resolveClientConfig({ YTENSUB_UPDATE_URL: value })).toThrow()
  })
})
