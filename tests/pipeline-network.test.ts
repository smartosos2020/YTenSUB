import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const moduleUrl = pathToFileURL(path.resolve('scripts/pipeline-network.mjs')).href
const { createPipelineNetwork, resolvePipelineProxy } = await import(moduleUrl)
const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }) })
function environment() {
  const APPDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ytensub-network-test-'))
  directories.push(APPDATA)
  fs.mkdirSync(path.join(APPDATA, 'YTenSUB'))
  return { APPDATA }
}

describe('采集网络预检与代理', () => {
  it('预检直连成功后才可开始采集，所有请求均有超时', async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 204 }))
    const network = createPipelineNetwork(environment(), { fetchFn })
    try {
      await network.check()
      expect(fetchFn).toHaveBeenCalledWith('https://www.youtube.com/generate_204', expect.objectContaining({ signal: expect.any(AbortSignal) }))
      expect((fetchFn.mock.calls as unknown as [string, object][])[0][1]).not.toHaveProperty('dispatcher')
    } finally { await network.close() }
  })

  it('超时明确报告连接错误和未发布，不吞成无字幕，也不暴露代理密码', async () => {
    const network = createPipelineNetwork({ ...environment(), PIPELINE_PROXY: 'http://user:secret@127.0.0.1:7890' }, {
      fetchFn: async () => { throw new Error('secret', { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }) }
    })
    try {
      await expect(network.check()).rejects.toThrow('UND_ERR_CONNECT_TIMEOUT')
      await expect(network.check()).rejects.toThrow('未开始采集，也未发布旧内容库')
      await expect(network.check()).rejects.not.toThrow('secret')
    } finally { await network.close() }
  })

  it('优先显式采集代理，其次环境代理，再读取应用代理；只对YouTube请求生效', async () => {
    const env = environment()
    fs.writeFileSync(path.join(env.APPDATA, 'YTenSUB', 'ytensub-data.json'), JSON.stringify({ settings: { proxy: 'http://127.0.0.1:7890' } }))
    expect(resolvePipelineProxy(env)).toBe('http://127.0.0.1:7890')
    expect(resolvePipelineProxy({ ...env, HTTPS_PROXY: 'http://env.example:80' })).toBe('http://env.example:80')
    expect(resolvePipelineProxy({ ...env, HTTPS_PROXY: 'http://env.example:80', PIPELINE_PROXY: 'http://local.example:80' })).toBe('http://local.example:80')
    const fetchFn = vi.fn(async () => new Response(null, { status: 204 }))
    const network = createPipelineNetwork(env, { fetchFn })
    try {
      await network.check()
      await network.fetch('https://api.example/admin/pipeline')
      const calls = fetchFn.mock.calls as unknown as [string, { dispatcher?: unknown }][]
      expect(calls[0][1].dispatcher).toBeDefined()
      expect(calls[1][1].dispatcher).toBeUndefined()
    } finally { await network.close() }
  })

  it('预检HTTP错误与不支持的代理类型给出可操作的原因', async () => {
    expect(() => createPipelineNetwork({ ...environment(), PIPELINE_PROXY: 'socks5://localhost:7891' })).toThrow('HTTP/HTTPS')
    const network = createPipelineNetwork(environment(), { fetchFn: async () => new Response('', { status: 429 }) })
    try { await expect(network.check()).rejects.toThrow('HTTP 429') } finally { await network.close() }
  })
})
