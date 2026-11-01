import http from 'node:http'
import os from 'node:os'
import { Store } from './store'
import { ShadowingScript, VocabItem } from '../shared/types'
import { mergeShadowing, mergeVocab } from '../shared/sync-merge'

export { mergeShadowing, mergeVocab } from '../shared/sync-merge'

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

export interface SyncServer {
  ip: string
  port: number
  token: string
  close: () => void
}

/**
 * 局域网同步服务：开启后手机端可拉取（GET /export）/推送（POST /import）。
 * 仅监听局域网，数据不加密（家庭网络场景）；服务随关闭动作/退出应用停止。
 */
export function startSyncServer(store: Store, token: string): Promise<SyncServer | null> {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'pairing required' }))
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
      // body 累加上限 10MB：超限直接 413 并销毁连接，防局域网内恶意/异常大请求撑爆内存
      const MAX_BODY = 10 * 1024 * 1024
      let body = ''
      let tooLarge = false
      req.on('data', (c: Buffer) => {
        if (tooLarge) return
        body += c
        if (body.length > MAX_BODY) {
          tooLarge = true
          res.writeHead(413)
          res.end('payload too large')
          req.destroy()
        }
      })
      req.on('error', () => {
        // 连接层错误兜底：无 error 监听进程会因 unhandled error 崩掉
        tooLarge = true
      })
      req.on('end', () => {
        if (tooLarge) return
        try {
          const payload = JSON.parse(body) as SyncPayload
          // 最小字段校验：坏条目直接丢弃，避免 merge/落盘链路因 undefined 字段崩掉
          const inVocab = (Array.isArray(payload.vocab) ? payload.vocab : []).filter(
            (v) => v && typeof v.text === 'string'
          )
          const inShadowing = (Array.isArray(payload.shadowing) ? payload.shadowing : []).filter(
            (s) => s && typeof s.videoId === 'string'
          )
          const vocab = mergeVocab(store.listVocab(), inVocab)
          const shadowing = mergeShadowing(store.listShadowing(), inShadowing)
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
      resolve({ ip, port: SYNC_PORT, token, close: () => server.close() })
    })
  })
}
