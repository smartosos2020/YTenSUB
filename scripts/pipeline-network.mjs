import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { ProxyAgent } from 'undici'

export function resolvePipelineProxy(env) {
  const configured = env.PIPELINE_PROXY || env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy
  if (configured?.trim()) return configured.trim()
  try {
    const data = JSON.parse(fs.readFileSync(path.join(env.APPDATA || os.homedir(), 'YTenSUB', 'ytensub-data.json'), 'utf8'))
    return data.settings?.proxy?.trim() || ''
  } catch { return '' }
}

export function createPipelineNetwork(env, { fetchFn = fetch } = {}) {
  const proxy = resolvePipelineProxy(env)
  let dispatcher
  if (proxy) {
    const url = new URL(proxy.includes('://') ? proxy : 'http://' + proxy)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('采集代理需使用 HTTP/HTTPS 地址，请配置 PIPELINE_PROXY（可使用代理软件的 HTTP 或 mixed 端口）')
    dispatcher = new ProxyAgent(url.href)
  }
  return {
    description: proxy ? '已配置 HTTP 采集代理' : '直连（未配置采集代理）',
    async fetch(url, init = {}) {
      const hostname = new URL(url).hostname
      const youtube = hostname === 'youtube.com' || hostname.endsWith('.youtube.com') || hostname.endsWith('.googleapis.com')
      return fetchFn(url, { ...init,
        signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
        ...(youtube && dispatcher ? { dispatcher } : {})
      })
    },
    async check() {
      try {
        const response = await this.fetch('https://www.youtube.com/generate_204')
        await response.body?.cancel()
        if (!response.ok) throw new Error('HTTP ' + response.status)
      } catch (error) {
        const code = error.cause?.code
        const detail = code && /^[A-Z0-9_]{1,64}$/.test(code) ? code : /^HTTP \d+$/.test(error.message) ? error.message : '连接失败或超时'
        throw new Error(`YouTube 网络预检失败（${detail}）；${proxy ? '请检查采集代理是否可用' : '当前直连不可用，请恢复 YouTube 网络连接或配置 PIPELINE_PROXY'}。未开始采集，也未发布旧内容库。`)
      }
    },
    async close() { await dispatcher?.close() }
  }
}
