import http from 'node:http'
import os from 'node:os'
import { Store } from './store'
import { ShadowingScript, VocabItem } from '../shared/types'

/** 同步载荷：生词本 + 跟读脚本（设置/字幕缓存不同步，前者各端独立，后者可重建） */
export interface SyncPayload {
  version: number
  exportedAt: number
  vocab: VocabItem[]
  shadowing: ShadowingScript[]
}

export const SYNC_PORT = 47832

/** 取局域网 IPv4 地址（跳过回环/内网链路本地地址） */
export function lanAddress(): string | null {
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const i of infos ?? []) {
      if (i.family === 'IPv4' && !i.internal) return i.address
    }
  }
  return null
}

/** 生词合并：按词（小写）去重——掌握等级取高者，其余字段取较新（addedAt 大）者 */
export function mergeVocab(local: VocabItem[], incoming: VocabItem[]): VocabItem[] {
  const byText = new Map<string, VocabItem>()
  for (const v of [...local, ...incoming]) {
    const key = v.text.trim().toLowerCase()
    const cur = byText.get(key)
    if (!cur) {
      byText.set(key, v)
      continue
    }
    const newer = v.addedAt > cur.addedAt ? v : cur
    const older = newer === v ? cur : v
    const level = Math.max(newer.reviewLevel ?? 0, older.reviewLevel ?? 0)
    byText.set(key, {
      ...newer,
      reviewLevel: level,
      // 到期时间取等级对应的那一份（等级来自谁就用谁的 due，避免错配）
      reviewDue: level === (newer.reviewLevel ?? 0) ? newer.reviewDue : older.reviewDue
    })
  }
  return [...byText.values()]
}

/** 跟读脚本合并：按 videoId，generatedAt 新者胜 */
export function mergeShadowing(
  local: ShadowingScript[],
  incoming: ShadowingScript[]
): ShadowingScript[] {
  const byId = new Map<string, ShadowingScript>()
  for (const s of [...local, ...incoming]) {
    const cur = byId.get(s.videoId)
    if (!cur || s.generatedAt > cur.generatedAt) byId.set(s.videoId, s)
  }
  return [...byId.values()]
}

export interface SyncServer {
  ip: string
  port: number
  close: () => void
}

/**
 * 局域网同步服务：开启后手机端可拉取（GET /export）/推送（POST /import）。
 * 仅监听局域网，数据不加密（家庭网络场景）；服务随关闭动作/退出应用停止。
 */
export function startSyncServer(store: Store): Promise<SyncServer | null> {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    if (req.method === 'GET' && req.url === '/export') {
      const payload: SyncPayload = {
        version: 1,
        exportedAt: Date.now(),
        vocab: store.listVocab(),
        shadowing: store.listShadowing()
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(payload))
      return
    }
    if (req.method === 'POST' && req.url === '/import') {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        try {
          const payload = JSON.parse(body) as SyncPayload
          const vocab = mergeVocab(store.listVocab(), payload.vocab ?? [])
          const shadowing = mergeShadowing(store.listShadowing(), payload.shadowing ?? [])
          // 经 replaceAll 落盘：复用现有的校验/备份/写盘链路
          const data = store.exportAll()
          data.vocab = vocab
          data.shadowing = Object.fromEntries(shadowing.map((s) => [s.videoId, s]))
          store.replaceAll(data)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, vocab: vocab.length, shadowing: shadowing.length }))
        } catch {
          res.writeHead(400)
          res.end('bad payload')
        }
      })
      return
    }
    res.writeHead(404)
    res.end()
  })

  return new Promise((resolve) => {
    server.on('error', () => resolve(null))
    server.listen(SYNC_PORT, '0.0.0.0', () => {
      const ip = lanAddress()
      if (!ip) {
        server.close()
        resolve(null)
        return
      }
      resolve({ ip, port: SYNC_PORT, close: () => server.close() })
    })
  })
}
