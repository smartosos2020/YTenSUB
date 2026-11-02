import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function readContentEnv() {
  const env = {}
  const envPath = path.join(root, '.env')
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.+)\s*$/.exec(line)
      if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '')
    }
  }
  return { ...env, ...process.env }
}

export function createContentApi({ apiUrl, uploadToken, fetchFn = fetch }) {
  const origin = new URL(apiUrl)
  if (origin.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) {
    throw new Error('Content API requires HTTPS')
  }
  if (!uploadToken) throw new Error('缺少 CONTENT_UPLOAD_TOKEN（或 ADMIN_TOKEN），无法发布内容')
  const base = origin.href.replace(/\/$/, '')
  async function request(method, key, body) {
    if (!/^(?:content-db\.json|index\.json|increments\/inc-\d{13,16}\.json|cues\/[\w-]{11}\.json)$/.test(key)) {
      throw new Error('Invalid content key')
    }
    let response
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetchFn(`${base}/admin/content/${key}`, {
        method, redirect: 'error',
        headers: { Authorization: `Bearer ${uploadToken}`, 'Content-Type': 'application/json' },
        body, signal: AbortSignal.timeout(60_000)
      })
      if (response.ok || response.status === 404 && method === 'GET') return response
      if (response.status !== 429 && response.status < 500 || attempt === 2) break
      await response.body?.cancel()
      await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt))
    }
    throw new Error(`Worker content ${method} ${key}: HTTP ${response.status}`)
  }
  return {
    async getJson(key, fallback) {
      const response = await request('GET', key)
      return response.status === 404 ? fallback : response.json()
    },
    async put(key, value) {
      const response = await request('PUT', key, JSON.stringify(value))
      return response.json()
    }
  }
}
