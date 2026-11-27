import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { ResourceDownloads } from '../src/main/resource-downloads'

// Opt-in real TCP transfer with synthetic files and a loopback-only tracker/seeder.
describe.skipIf(process.env.YTENSUB_TEST_RQBIT !== '1' || process.platform !== 'win32')('rqbit 实际 P2P 集成', () => {
  it('磁力解析、只下载所选文件、暂停、重启续传、完成后停止做种和保留文件移除', async () => {
    const binary = path.resolve('resources/engines/rqbit.exe')
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ytensub-p2p-test-'))
    const previousDht = process.env.RQBIT_DHT_DISABLE
    const previousLsd = process.env.RQBIT_LSD_DISABLE
    process.env.RQBIT_DHT_DISABLE = 'true'
    process.env.RQBIT_LSD_DISABLE = 'true'
    const bencode = (value: Buffer | string | number | unknown[] | Record<string, unknown>): Buffer => {
      if (Buffer.isBuffer(value)) return Buffer.concat([Buffer.from(`${value.length}:`), value])
      if (typeof value === 'string') return bencode(Buffer.from(value))
      if (typeof value === 'number') return Buffer.from(`i${value}e`)
      if (Array.isArray(value)) return Buffer.concat([Buffer.from('l'), ...value.map((item) => bencode(item as string)), Buffer.from('e')])
      return Buffer.concat([Buffer.from('d'), ...Object.keys(value).sort().flatMap((key) => [bencode(key), bencode(value[key] as string)]), Buffer.from('e')])
    }
    const port = (): Promise<number> => new Promise((resolve, reject) => {
      const server = createServer(); server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { const p = (server.address() as { port: number }).port; server.close(() => resolve(p)) })
    })
    const apiPort = await port(), seedPort = await port()
    const tracker = createHttpServer((_req, res) => {
      const peer = Buffer.from([127, 0, 0, 1, seedPort >> 8, seedPort & 255])
      res.end(bencode({ interval: 1, peers: peer }))
    })
    await new Promise<void>((resolve) => tracker.listen(0, '127.0.0.1', resolve))
    const trackerPort = (tracker.address() as { port: number }).port
    const first = Buffer.alloc(1024 * 1024, 0x31), second = Buffer.alloc(1024 * 1024, 0x72)
    const all = Buffer.concat([first, second])
    const pieces = []
    for (let i = 0; i < all.length; i += 16384) pieces.push(createHash('sha1').update(all.subarray(i, i + 16384)).digest())
    const info = { name: 'Synthetic.Show', 'piece length': 16384, pieces: Buffer.concat(pieces),
      files: [{ length: first.length, path: ['Episode01.mp4'] }, { length: second.length, path: ['Episode02.mp4'] }] }
    const infoHash = createHash('sha1').update(bencode(info)).digest('hex')
    const torrent = bencode({ announce: `http://127.0.0.1:${trackerPort}/announce`, info })
    const seedRoot = path.join(root, 'seed')
    await fs.mkdir(seedRoot, { recursive: true })
    await fs.writeFile(path.join(seedRoot, 'Episode01.mp4'), first)
    await fs.writeFile(path.join(seedRoot, 'Episode02.mp4'), second)
    let seeder: ChildProcess | undefined
    let downloads: ResourceDownloads | undefined
    const localTracker = `http://127.0.0.1:${trackerPort}/announce`
    const options = { binary, dataDirectory: path.join(root, 'state'), defaultDirectory: path.join(root, '下载 test'), fallbackTrackers: [localTracker] }
    const rpc = async (route: string, init?: RequestInit): Promise<unknown> => {
      const res = await fetch(`http://127.0.0.1:${apiPort}${route}`, { ...init, signal: AbortSignal.timeout(2000) })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    }
    const until = async <T,>(fn: () => Promise<T>, accept: (value: T) => boolean, timeout = 12000): Promise<T> => {
      const end = Date.now() + timeout
      let last: T | undefined
      while (Date.now() < end) { last = await fn(); if (accept(last)) return last; await delay(150) }
      throw new Error(`Timed out waiting for rqbit integration state: ${JSON.stringify(last)}`)
    }
    try {
      seeder = spawn(binary, ['-v', 'error', '--http-api-listen-addr', `127.0.0.1:${apiPort}`, '--listen-ip', '127.0.0.1',
        '--listen-port', String(seedPort), '--disable-dht', '--disable-lsd', '--disable-upnp-port-forward', 'server', 'start', '--disable-persistence', seedRoot], { windowsHide: true, stdio: 'ignore' })
      for (let i = 0; i < 60; i++) { try { await rpc('/'); break } catch { await delay(100) } }
      await rpc(`/torrents?is_url=false&overwrite=true&output_folder=${encodeURIComponent(seedRoot)}`, { method: 'POST', body: Uint8Array.from(torrent).buffer })
      await until(() => rpc(`/torrents/${infoHash}/stats/v1`) as Promise<{ finished: boolean }>, (stats) => stats.finished)
      downloads = new ResourceDownloads(options)
      const preview = await downloads.previewMagnet(`magnet:?xt=urn:btih:${infoHash}&tr=${encodeURIComponent(`http://127.0.0.1:${trackerPort}/announce`)}`)
      expect(preview.files.map((file) => file.name)).toEqual(['Episode01.mp4', 'Episode02.mp4'])
      expect((await downloads.snapshot()).tasks).toHaveLength(0)
      await downloads.configure({ downloadLimitKB: 64 })
      await downloads.add(preview.token, [1])
      await until(() => downloads!.snapshot(), (s) => s.tasks[0]?.state === 'live' && s.tasks[0].downloaded > 0)
      await downloads.action(infoHash, 'pause')
      const paused = (await until(() => downloads!.snapshot(), (s) => s.tasks[0]?.state === 'paused')).tasks[0]
      expect(paused.state).toBe('paused')
      expect(paused.finished).toBe(false)
      await downloads.stop()
      // Reproduce older search magnets: both persisted configuration and cached metadata lost trackers.
      const sessionDirectory = path.join(options.dataDirectory, 'session')
      const sessionFile = path.join(sessionDirectory, 'session.json')
      const saved = JSON.parse(await fs.readFile(sessionFile, 'utf8'))
      for (const task of Object.values(saved.torrents) as { trackers: string[] }[]) task.trackers = []
      await fs.writeFile(sessionFile, JSON.stringify(saved))
      await fs.writeFile(path.join(sessionDirectory, infoHash + '.torrent'), bencode({ info }))
      downloads = new ResourceDownloads(options)
      const restored = await until(() => downloads!.snapshot(), (s) => s.tasks[0]?.state === 'paused')
      // rqbit must retain the repaired trackers after reading and re-saving its cached torrent.
      const repairedSession = JSON.parse(await fs.readFile(sessionFile, 'utf8'))
      expect((Object.values(repairedSession.torrents)[0] as { trackers: string[] }).trackers).toContain(localTracker)
      expect(restored.tasks[0].downloaded).toBeGreaterThan(0)
      expect(restored.settings.downloadLimitKB).toBe(64)
      await downloads.configure({ downloadLimitKB: 0 })
      await downloads.action(infoHash, 'start')
      const complete = await until(() => downloads!.snapshot(), (s) => s.tasks[0]?.finished === true)
      expect(complete.tasks[0].state).toBe('paused')
      const filePath = await downloads.filePath(infoHash, 1)
      expect(await fs.readFile(filePath)).toEqual(second)
      expect(complete.tasks[0].total).toBe(second.length)
      expect(complete.tasks[0].files[0].selected).toBe(false)
      // rqbit creates placeholders for omitted files; their pieces must remain undownloaded.
      expect((await fs.readFile(path.join(path.dirname(filePath), 'Episode01.mp4'))).every((byte) => byte === 0)).toBe(true)
      await expect(downloads.filePath(infoHash, 0)).rejects.toThrow('下载完成')
      await downloads.stop()
      downloads = new ResourceDownloads(options)
      const restarted = await downloads.snapshot()
      expect(restarted.tasks).toHaveLength(1)
      expect(restarted.tasks[0].finished || restarted.tasks[0].previouslyFinished).toBe(true)
      await until(() => downloads!.snapshot(), (s) => s.tasks[0]?.finished === true)
      await downloads.action(infoHash, 'forget')
      expect((await downloads.snapshot()).tasks).toHaveLength(0)
      expect(await fs.readFile(filePath)).toEqual(second)
    } finally {
      await downloads?.stop()
      seeder?.kill()
      tracker.closeAllConnections()
      await new Promise<void>((resolve) => tracker.close(() => resolve()))
      process.env.RQBIT_DHT_DISABLE = previousDht
      process.env.RQBIT_LSD_DISABLE = previousLsd
      // Keep synthetic artifacts for troubleshooting; no user files are touched.
    }
  }, 100000)
})
