import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'node:net'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type { DownloadSettings, DownloadSnapshot, DownloadTask, ResourceFile, ResourcePreview } from '../shared/resources'
import { LOCAL_VIDEO_EXTENSIONS } from './local-media'
import { repairTrackerlessSession, RESOURCE_TRACKERS, withFallbackTrackers } from './resource-trackers'

interface EngineFile { name: string; components?: string[]; length: number; included: boolean }
interface EngineStats {
  state: DownloadTask['state']; finished: boolean; progress_bytes: number; total_bytes: number
  uploaded_bytes: number; file_progress: number[]; error?: string
  live?: { download_speed?: { mbps: number }; upload_speed?: { mbps: number }; snapshot?: { peer_stats?: { live: number; seen?: number; dead?: number; connecting?: number } } }
}
interface EngineDetails { id: number | null; info_hash: string; name?: string; output_folder: string; files?: EngineFile[]; stats?: EngineStats }
interface AddResponse { id: number | null; details: EngineDetails; seen_peers?: string[] }
interface PreviewEntry { body: string | Buffer; details: EngineDetails; peers: string[]; created: number }

export function validateMagnet(value: unknown): string {
  if (typeof value !== 'string' || value.length > 16_384) throw new Error('磁力链接无效')
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new Error('请输入有效的 magnet: 磁力链接') }
  if (url.protocol !== 'magnet:' || !url.searchParams.getAll('xt').some((xt) => /^urn:btih:(?:[a-f0-9]{40}|[a-z2-7]{32})$/i.test(xt))) {
    throw new Error('请输入包含 BT v1 信息哈希的磁力链接')
  }
  const xt = url.searchParams.getAll('xt').find((item) => /^urn:btih:(?:[a-f0-9]{40}|[a-z2-7]{32})$/i.test(item))!
  const hash = xt.slice(9)
  // rqbit expects hexadecimal hashes; common Base32 magnets need normalization.
  if (hash.length === 32) {
    let accumulator = 0, bits = 0
    const bytes: number[] = []
    for (const char of hash.toUpperCase()) {
      accumulator = (accumulator << 5) | 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char)
      bits += 5
      if (bits >= 8) { bits -= 8; bytes.push((accumulator >> bits) & 255); accumulator &= (1 << bits) - 1 }
    }
    url.searchParams.set('xt', `urn:btih:${Buffer.from(bytes).toString('hex')}`)
  } else if (xt !== `urn:btih:${hash.toLowerCase()}`) url.searchParams.set('xt', `urn:btih:${hash.toLowerCase()}`)
  // Trackers can only be network addresses, never local files.
  for (const tracker of url.searchParams.getAll('tr')) {
    if (!/^(?:https?|udp):\/\//i.test(tracker)) throw new Error('磁力链接中的 Tracker 地址无效')
  }
  return url.toString()
}

export function containedFile(directory: string, components: string[]): string {
  if (!components.length || components.some((part) => !part || part === '.' || part === '..' || /[\\/:]/.test(part) || part.includes('\0'))) {
    throw new Error('种子包含无效文件路径')
  }
  const root = path.resolve(directory)
  const target = path.resolve(root, ...components)
  if (!target.startsWith(root + path.sep)) throw new Error('文件路径超出下载目录')
  return target
}

function filesOf(details: EngineDetails, stats?: EngineStats): ResourceFile[] {
  return (details.files ?? []).map((file, index) => ({
    index, name: file.name, size: file.length, selected: file.included,
    completed: file.included && file.length > 0 && (stats?.file_progress?.[index] ?? 0) >= file.length
  }))
}

async function freePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const chosen = typeof address === 'object' && address ? address.port : 0
      server.close((error) => error ? reject(error) : resolve(chosen))
    })
  })
}

/** Owns a pinned rqbit child process. The renderer never receives its port or credentials. */
export class ResourceDownloads {
  private child?: ChildProcess
  private port = 0
  private auth = ''
  private starting?: Promise<void>
  private stopping = false
  private previewAbort?: AbortController
  private previews = new Map<string, PreviewEntry>()
  private details = new Map<string, EngineDetails>()
  private timer?: ReturnType<typeof setInterval>
  private refreshing?: Promise<DownloadSnapshot>
  private settings: DownloadSettings
  private readonly configFile: string
  private readonly completedFile: string
  private completed = new Map<string, string>()
  private diagnosticAt = 0

  constructor(private readonly options: { binary: string; dataDirectory: string; defaultDirectory: string; proxy?: () => string; fallbackTrackers?: readonly string[] }) {
    this.configFile = path.join(options.dataDirectory, 'downloads.json')
    this.completedFile = path.join(options.dataDirectory, 'completed.json')
    try {
      const saved: unknown = JSON.parse(fs.readFileSync(this.completedFile, 'utf8'))
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
        for (const [id, signature] of Object.entries(saved)) {
          if (/^[a-f0-9]{40}$/.test(id) && typeof signature === 'string' && /^[a-f0-9]{64}$/.test(signature)) this.completed.set(id, signature)
        }
      }
    } catch { /* Older installations have no completion history. */ }
    this.settings = { directory: options.defaultDirectory, downloadLimitKB: 0, uploadLimitKB: 128, seedAfterDownload: false }
    try {
      const saved = JSON.parse(fs.readFileSync(this.configFile, 'utf8')) as DownloadSettings
      if (typeof saved.directory === 'string' && path.isAbsolute(saved.directory)) this.settings.directory = saved.directory
      for (const key of ['downloadLimitKB', 'uploadLimitKB'] as const) {
        if (Number.isInteger(saved[key]) && saved[key] >= 0 && saved[key] <= 1_000_000) this.settings[key] = saved[key]
      }
      this.settings.seedAfterDownload = saved.seedAfterDownload === true
    } catch { /* Defaults on first launch. */ }
  }

  getSettings(): DownloadSettings { return { ...this.settings } }

  async configure(patch: Partial<Omit<DownloadSettings, 'directory'>>): Promise<DownloadSettings> {
    const next = { ...this.settings }
    for (const key of ['downloadLimitKB', 'uploadLimitKB'] as const) {
      if (patch[key] !== undefined) {
        if (!Number.isInteger(patch[key]) || patch[key]! < 0 || patch[key]! > 1_000_000) throw new Error('限速值无效')
        if (patch[key]! > 0 && patch[key]! < 64) throw new Error('限速请设为 0（不限速）或至少 64 KB/s')
        next[key] = patch[key]!
      }
    }
    if (patch.seedAfterDownload !== undefined) {
      if (typeof patch.seedAfterDownload !== 'boolean') throw new Error('做种设置无效')
      next.seedAfterDownload = patch.seedAfterDownload
    }
    if (this.child) await this.applyLimits(next)
    this.settings = next
    this.saveSettings()
    return this.getSettings()
  }

  async setDirectory(directory: string): Promise<DownloadSettings> {
    const resolved = await fs.promises.realpath(directory)
    if (!(await fs.promises.stat(resolved)).isDirectory()) throw new Error('请选择下载文件夹')
    this.settings.directory = resolved
    this.saveSettings()
    return this.getSettings()
  }

  private saveSettings(): void {
    fs.mkdirSync(this.options.dataDirectory, { recursive: true })
    fs.writeFileSync(this.configFile + '.tmp', JSON.stringify(this.settings))
    fs.renameSync(this.configFile + '.tmp', this.configFile)
  }

  private saveCompleted(): void {
    try {
      fs.mkdirSync(this.options.dataDirectory, { recursive: true })
      fs.writeFileSync(this.completedFile + '.tmp', JSON.stringify(Object.fromEntries(this.completed)))
      fs.renameSync(this.completedFile + '.tmp', this.completedFile)
    } catch { this.log('Could not persist download completion history') }
  }

  private async request<T>(route: string, init?: RequestInit, timeout = 8000): Promise<T> {
    const signal = init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout)
    const response = await fetch(`http://127.0.0.1:${this.port}${route}`, {
      ...init, headers: { Authorization: `Basic ${this.auth}`, ...init?.headers }, signal
    })
    if (!response.ok) {
      const message = (await response.text()).slice(0, 500)
      throw new Error(`下载引擎请求失败（${response.status}）：${message}`)
    }
    return await response.json() as T
  }

  private async applyLimits(settings: DownloadSettings): Promise<void> {
    await this.request('/torrents/limits', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ download_bps: settings.downloadLimitKB ? settings.downloadLimitKB * 1024 : null,
        upload_bps: settings.uploadLimitKB ? settings.uploadLimitKB * 1024 : null })
    })
  }

  async ensureStarted(): Promise<void> {
    if (this.stopping) throw new Error('下载引擎正在关闭')
    if (this.starting) return this.starting
    if (this.child && this.port) return
    this.starting = this.start()
    try { await this.starting } finally { this.starting = undefined }
  }

  private async start(): Promise<void> {
    if (process.platform !== 'win32') throw new Error('当前下载引擎仅打包了 Windows 版本')
    if (!fs.existsSync(this.options.binary)) throw new Error('下载引擎缺失，请运行 npm run predev 或重新安装应用')
    fs.mkdirSync(this.options.dataDirectory, { recursive: true })
    const repaired = repairTrackerlessSession(path.join(this.options.dataDirectory, 'session'), this.options.fallbackTrackers)
    this.log(`engine starting; repaired trackerless tasks=${repaired}`)
    const port = await freePort()
    let peerPort = await freePort()
    while (peerPort === port) peerPort = await freePort()
    this.port = port
    const password = randomBytes(32).toString('hex')
    this.auth = Buffer.from(`ytensub:${password}`).toString('base64')
    const args = ['-v', 'warn', '--http-api-listen-addr', `127.0.0.1:${port}`,
      '--listen-port', String(peerPort), '--disable-dht-persistence', '--disable-upnp-port-forward',
      '--worker-threads', '2', '--peer-limit', '60', '--concurrent-init-limit', '1', '--peer-connect-timeout', '8s']
    const proxy = this.options.proxy?.().trim() ?? ''
    if (/^socks5h?:\/\//i.test(proxy)) args.push('--socks-url', proxy)
    args.push('server', 'start', '--persistence-location', path.join(this.options.dataDirectory, 'session'), this.settings.directory)
    const child = spawn(this.options.binary, args, {
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, RQBIT_HTTP_BASIC_AUTH_USERPASS: `ytensub:${password}` }
    })
    this.child = child
    this.details.clear()
    let failure = ''
    child.stdout?.on('data', (data: Buffer) => this.log(data.toString()))
    child.stderr?.on('data', (data: Buffer) => this.log(data.toString()))
    child.once('error', (error) => { failure = error.message })
    child.once('exit', () => {
      if (this.child !== child) return
      this.child = undefined
      this.port = 0
      if (this.timer) clearInterval(this.timer)
      this.timer = undefined
    })
    try {
      let ready = false
      for (let attempt = 0; attempt < 60; attempt++) {
        if (failure || child.exitCode !== null || child.signalCode !== null) throw new Error(failure || 'rqbit 启动失败')
        try {
          const root = await this.request<{ server: string }>('/', undefined, 400)
          if (root.server === 'rqbit') { ready = true; break }
        } catch { /* Wait for the loopback listener. */ }
        await delay(100)
      }
      if (!ready) throw new Error('下载引擎启动超时')
      await this.applyLimits(this.settings)
      this.timer = setInterval(() => { void this.snapshot().catch(() => {}) }, 2500)
      this.timer.unref()
    } catch (error) {
      child.kill()
      this.child = undefined
      this.port = 0
      throw error
    }
  }

  cancelPreview(): void { this.previewAbort?.abort() }

  private log(message: string): void {
    // One bounded local diagnostic file; never log API credentials or URL credentials/query strings.
    try {
      const filename = path.join(this.options.dataDirectory, 'engine.log')
      if (fs.existsSync(filename) && fs.statSync(filename).size > 256 * 1024) fs.renameSync(filename, filename + '.previous')
      const clean = message.replace(new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g'), '').replace(/(?:https?|socks5h?):\/\/[^\s"<>]+/g, (value) => {
        try { const url = new URL(value); url.username = ''; url.password = ''; url.search = ''; return url.toString() } catch { return '[URL]' }
      })
      fs.appendFileSync(filename, `${new Date().toISOString()} ${clean.slice(0, 8192)}\n`)
    } catch { /* Diagnostics must not interrupt a transfer. */ }
  }

  async previewMagnet(value: string): Promise<ResourcePreview> {
    const magnet = new URL(validateMagnet(value))
    if (!magnet.searchParams.has('tr')) {
      for (const tracker of this.options.fallbackTrackers ?? RESOURCE_TRACKERS) magnet.searchParams.append('tr', tracker)
    }
    return this.preview(magnet.toString())
  }

  async previewTorrent(buffer: Buffer): Promise<ResourcePreview> {
    if (!buffer.length || buffer.length > 8 * 1024 * 1024) throw new Error('种子文件为空或超过 8 MB')
    return this.preview(withFallbackTrackers(buffer, this.options.fallbackTrackers))
  }

  private async preview(body: string | Buffer): Promise<ResourcePreview> {
    this.cancelPreview()
    const controller = new AbortController()
    this.previewAbort = controller
    await this.ensureStarted()
    const params = new URLSearchParams({ list_only: 'true', is_url: String(typeof body === 'string'), timeout_ms: '60000' })
    let result: AddResponse
    try {
      result = await this.request<AddResponse>(`/torrents?${params}`, {
        method: 'POST', body: typeof body === 'string' ? body : Uint8Array.from(body).buffer, signal: controller.signal
      }, 62_000)
    } catch (error) {
      if (controller.signal.aborted) throw new Error('已取消解析', { cause: error })
      if (error instanceof Error && /timeout|aborted/i.test(error.message)) throw new Error('磁力解析超时，可能暂时没有可连接的节点，请换一个资源或稍后重试', { cause: error })
      throw error
    } finally {
      if (this.previewAbort === controller) this.previewAbort = undefined
    }
    if (result.id !== null) throw new Error('该资源已在下载列表中')
    if (!/^[a-f0-9]{40}$/i.test(result.details.info_hash) || !result.details.files?.length) throw new Error('未能获取种子文件列表')
    for (const file of result.details.files) containedFile(result.details.output_folder, file.components ?? file.name.split(/[\\/]/))
    for (const [key, entry] of this.previews) {
      if (Date.now() - entry.created > 10 * 60_000 || this.previews.size >= 10) this.previews.delete(key)
    }
    const token = randomUUID()
    this.previews.set(token, { body, details: result.details, peers: result.seen_peers ?? [], created: Date.now() })
    return { token, name: result.details.name ?? '未命名资源', infoHash: result.details.info_hash, files: filesOf(result.details) }
  }

  async add(token: string, selected: number[]): Promise<void> {
    const entry = this.previews.get(token)
    if (!entry || Date.now() - entry.created > 10 * 60_000) throw new Error('文件列表已过期，请重新解析')
    if (!Array.isArray(selected) || !selected.length || selected.some((id) => !Number.isInteger(id) || id < 0 || id >= (entry.details.files?.length ?? 0))) {
      throw new Error('请至少选择一个有效文件')
    }
    await this.ensureStarted()
    const folderName = [...(entry.details.name ?? '资源')].map((char) => char.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(char) ? '_' : char).join('').replace(/[. ]+$/g, '').slice(0, 100) || '资源'
    const params = new URLSearchParams({
      is_url: String(typeof entry.body === 'string'), output_folder: path.join(this.settings.directory, `${folderName}-${entry.details.info_hash.slice(0, 8)}`),
      only_files: [...new Set(selected)].join(','), timeout_ms: '60000', overwrite: 'true'
    })
    if (entry.peers.length) params.set('initial_peers', entry.peers.slice(0, 30).join(','))
    await this.request(`/torrents?${params}`, {
      method: 'POST', body: typeof entry.body === 'string' ? entry.body : Uint8Array.from(entry.body).buffer
    }, 62_000)
    this.previews.delete(token)
  }

  async action(id: string, action: 'pause' | 'start' | 'forget'): Promise<void> {
    this.checkId(id)
    if (!['pause', 'start', 'forget'].includes(action)) throw new Error('下载操作无效')
    await this.ensureStarted()
    await this.request(`/torrents/${id}/${action}`, { method: 'POST' })
    if (action === 'forget') {
      this.details.delete(id)
      if (this.completed.delete(id)) this.saveCompleted()
    }
  }

  private checkId(id: string): void { if (typeof id !== 'string' || !/^[a-f0-9]{40}$/i.test(id)) throw new Error('下载任务标识无效') }

  async snapshot(): Promise<DownloadSnapshot> {
    await this.ensureStarted()
    if (this.refreshing) return this.refreshing
    this.refreshing = this.readSnapshot()
    try { return await this.refreshing } finally { this.refreshing = undefined }
  }

  private async readSnapshot(): Promise<DownloadSnapshot> {
    const result = await this.request<{ torrents: EngineDetails[] }>('/torrents?with_stats=true')
    let completionChanged = false
    const tasks = await Promise.all(result.torrents.map(async (torrent): Promise<DownloadTask> => {
      const id = torrent.info_hash
      let details = this.details.get(id)
      if (!details?.files?.length) {
        details = await this.request<EngineDetails>(`/torrents/${id}`)
        this.details.set(id, details)
      }
      const stats = torrent.stats
      // Completion is scoped to the directory and exact file selection, not merely the info hash.
      const signature = createHash('sha256').update(JSON.stringify([details.output_folder,
        details.files?.map((file) => [file.name, file.length, file.included])])).digest('hex')
      const previouslyFinished = this.completed.get(id) === signature
      // Initializing progress counts bytes checked on disk. It is not downloaded data.
      // Retain only the display category; file playback still requires current verified progress.
      if (stats && stats.state !== 'initializing') {
        if (stats.finished) {
          if (!previouslyFinished) { this.completed.set(id, signature); completionChanged = true }
        } else if (this.completed.delete(id)) completionChanged = true
      }
      const peerStats = stats?.live?.snapshot?.peer_stats
      if (stats?.finished && stats.state === 'live' && !this.settings.seedAfterDownload) {
        await this.request(`/torrents/${id}/pause`, { method: 'POST' })
        stats.state = 'paused'
      }
      return {
        id, name: details.name ?? torrent.name ?? id, directory: details.output_folder,
        state: stats?.state ?? 'initializing', finished: stats?.finished ?? false,
        previouslyFinished: (!stats || stats.state === 'initializing') && previouslyFinished,
        downloaded: stats?.progress_bytes ?? 0, total: stats?.total_bytes ?? 0, uploaded: stats?.uploaded_bytes ?? 0,
        downloadSpeed: (stats?.live?.download_speed?.mbps ?? 0) * 1024 ** 2,
        uploadSpeed: (stats?.live?.upload_speed?.mbps ?? 0) * 1024 ** 2,
        peers: stats?.live?.snapshot?.peer_stats?.live ?? 0,
        discoveredPeers: peerStats?.seen ?? 0, failedPeers: peerStats?.dead ?? 0, connectingPeers: peerStats?.connecting ?? 0,
        error: stats?.error ?? undefined, files: filesOf(details, stats)
      }
    }))
    if (completionChanged) this.saveCompleted()
    if (Date.now() - this.diagnosticAt > 30_000) {
      this.diagnosticAt = Date.now()
      this.log(JSON.stringify(tasks.map(({ id, state, downloaded, total, peers, discoveredPeers, failedPeers, connectingPeers, error }) =>
        ({ id, state, downloaded, total, peers, discoveredPeers, failedPeers, connectingPeers, error }))))
    }
    return { settings: this.getSettings(), tasks }
  }

  async filePath(id: string, fileIndex?: number): Promise<string> {
    this.checkId(id)
    const snapshot = await this.snapshot()
    const task = snapshot.tasks.find((item) => item.id === id)
    if (!task) throw new Error('下载任务不存在')
    if (fileIndex === undefined) return fs.promises.realpath(task.directory)
    if (task.state === 'initializing') throw new Error('本地文件正在校验，请稍后播放')
    const file = task.files.find((item) => item.index === fileIndex && item.selected && item.completed)
    if (!file || !LOCAL_VIDEO_EXTENSIONS.includes(path.extname(file.name).slice(1).toLowerCase())) throw new Error('请等待视频文件下载完成')
    const details = this.details.get(id)!
    const engineFile = details.files![fileIndex]
    const candidate = containedFile(task.directory, engineFile.components ?? engineFile.name.split(/[\\/]/))
    const [root, resolved] = await Promise.all([fs.promises.realpath(task.directory), fs.promises.realpath(candidate)])
    if (!resolved.startsWith(root + path.sep)) throw new Error('视频文件不在下载目录内')
    return resolved
  }

  async stop(): Promise<void> {
    this.stopping = true
    this.cancelPreview()
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    if (this.starting) await this.starting.catch(() => {})
    const child = this.child
    if (!child) return
    try {
      const list = await this.request<{ torrents: EngineDetails[] }>('/torrents', undefined, 1000)
      await Promise.allSettled(list.torrents.map((torrent) => this.request(`/torrents/${torrent.info_hash}/pause`, { method: 'POST' }, 1500)))
    } catch { /* Still stop our child if the API is unavailable. */ }
    const exited = new Promise<void>((resolve) => { child.once('exit', () => resolve()) })
    child.kill()
    await Promise.race([exited, delay(1500)])
    this.child = undefined
    this.port = 0
  }
}
