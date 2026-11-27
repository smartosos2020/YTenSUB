import { useCallback, useEffect, useRef, useState } from 'react'
import { ActionIcon, Button, Checkbox, Loader, Modal, NumberInput, TextInput, Tooltip } from '@mantine/core'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import type { DownloadSettings, DownloadTask, ResourcePreview, ResourceResult } from '../../../shared/resources'
import { isCompletedDownload } from '../../../shared/resources'
import PageShell from '../components/PageShell'
import { usePersistentState } from '../hooks/usePersistentState'
import FolderOpenIcon from '../components/icons/FolderOpenIcon'
import TrashIcon from '../components/icons/TrashIcon'
import PlayerIconButton from '../components/PlayerIconButton'
import MagnetIcon from '../components/icons/MagnetIcon'
import FilePlusIcon from '../components/icons/FilePlusIcon'
import GearIcon from '../components/icons/GearIcon'
import RefreshIcon from '../components/icons/RefreshIcon'
import PlayIcon from '../components/icons/PlayIcon'

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': Error: /, '')
}

export function resourceSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

const isVideo = (name: string): boolean => /\.(mp4|m4v|webm|mov|mkv|avi)$/i.test(name)

export default function ResourcesPage({ isActive = true }: { isActive?: boolean }): JSX.Element {
  const navigate = useNavigate()
  const [query, setQuery] = usePersistentState<string>('ytensub:resource-query', '')
  const [tab, setTab] = useState<'search' | 'active' | 'completed'>('search')
  const [results, setResults] = useState<ResourceResult[]>([])
  const [searched, setSearched] = useState(false)
  const [searching, setSearching] = useState(false)
  const [tasks, setTasks] = useState<DownloadTask[]>([])
  const [settings, setSettings] = useState<DownloadSettings | null>(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [magnetOpen, setMagnetOpen] = useState(false)
  const [magnet, setMagnet] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [preview, setPreview] = useState<ResourcePreview | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [adding, setAdding] = useState(false)
  const [busyTask, setBusyTask] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [draft, setDraft] = useState<DownloadSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const previewRequest = useRef(0)
  const mounted = useRef(true)

  const refresh = useCallback(async (): Promise<void> => {
    const snapshot = await api.resourceSnapshot()
    if (!mounted.current) return
    setSettings(snapshot.settings)
    setTasks(snapshot.tasks)
  }, [])

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; void api.resourceCancelPreview().catch(() => {}) }
  }, [])

  useEffect(() => {
    if (!isActive) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async (): Promise<void> => {
      try { await refresh() } catch (e) { if (!cancelled && mounted.current) setError(message(e)) }
      if (!cancelled) timer = setTimeout(() => { void tick() }, 2500)
    }
    void tick()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [isActive, refresh])

  const search = async (): Promise<void> => {
    if (!query.trim() || searching) return
    setError(''); setSearching(true); setSearched(true); setResults([])
    try { setResults(await api.resourceSearch(query.trim())) } catch (e) { setError(message(e)) }
    finally { setSearching(false) }
  }

  const prepare = async (uri?: string): Promise<void> => {
    const request = ++previewRequest.current
    setError(''); setMagnetOpen(false); setPreviewOpen(true); setPreparing(true); setPreview(null)
    try {
      const result = uri ? await api.resourcePreview(uri) : await api.resourcePickTorrent()
      if (request !== previewRequest.current || !mounted.current) return
      if (!result) { setPreviewOpen(false); return }
      setPreview(result)
      setSelected(result.files.filter((file) => isVideo(file.name)).map((file) => file.index))
    } catch (e) {
      if (request === previewRequest.current) { setPreviewOpen(false); setError(message(e)) }
    } finally { if (request === previewRequest.current) setPreparing(false) }
  }

  const closePreview = (): void => {
    if (adding) return
    ++previewRequest.current
    setPreviewOpen(false); setPreparing(false)
    void api.resourceCancelPreview().catch(() => {})
  }

  const chooseDirectory = async (): Promise<void> => {
    try { const result = await api.resourcePickDirectory(); if (result) setSettings(result) } catch (e) { setError(message(e)) }
  }

  const add = async (): Promise<void> => {
    if (!preview || !selected.length || adding) return
    setAdding(true); setError('')
    try {
      await api.resourceAdd(preview.token, selected)
      setPreviewOpen(false); setTab('active'); await refresh()
    } catch (e) { setError(message(e)) } finally { setAdding(false) }
  }

  const action = async (id: string, operation: 'pause' | 'start' | 'forget'): Promise<void> => {
    setBusyTask(id); setError('')
    try { await api.resourceAction(id, operation); await refresh() } catch (e) { setError(message(e)) }
    finally { setBusyTask(null) }
  }

  const play = async (id: string, index: number): Promise<void> => {
    setBusyTask(id); setError('')
    try {
      const video = await api.resourceOpenVideo(id, index)
      navigate('/local', { state: { downloadedVideo: video, downloadRequest: crypto.randomUUID() } })
    } catch (e) { setError(message(e)) } finally { setBusyTask(null) }
  }

  const activeCount = tasks.filter((task) => !isCompletedDownload(task)).length
  const completedCount = tasks.filter(isCompletedDownload).length
  const shownTasks = tasks.filter((task) => tab === 'completed' ? isCompletedDownload(task) : !isCompletedDownload(task))

  return <PageShell title="资源" desc="搜索视频资源，选择文件下载，完成后直接播放。" descActions={<>
    <PlayerIconButton label="添加磁力" onClick={() => setMagnetOpen(true)}><MagnetIcon /></PlayerIconButton>
    <PlayerIconButton label="添加种子" onClick={() => void prepare()}><FilePlusIcon /></PlayerIconButton>
    <PlayerIconButton label="下载设置" disabled={!settings} onClick={() => { setDraft(settings); setSettingsOpen(true) }}><GearIcon /></PlayerIconButton>
  </>}>
    <div className="resource-tabs" role="tablist" aria-label="资源视图">
      {([['search', '搜索'], ['active', `下载中 (${activeCount})`], ['completed', `已完成 (${completedCount})`]] as const).map(([value, label]) =>
        <button key={value} type="button" role="tab" aria-selected={tab === value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>{label}</button>)}
    </div>
    {error && <div className="resource-error" role="alert">{error}<button type="button" aria-label="关闭提示" onClick={() => setError('')}>×</button></div>}
    {tab === 'search' ? <>
      <form className="resource-search" onSubmit={(event) => { event.preventDefault(); void search() }}>
        <TextInput aria-label="搜索视频资源" placeholder="剧名、关键词或具体季集，例如 Young Sheldon S01E02" value={query} onChange={(event) => setQuery(event.currentTarget.value)} maxLength={160} />
        <Button type="submit" loading={searching} disabled={!query.trim()}>搜索</Button>
      </form>
      <p className="resource-note">来源：The Pirate Bay · 结果按做种人数排序。搜索具体集数时会匹配季集。</p>
      {!searched && <div className="resource-empty">输入剧名或关键词开始搜索，也可以添加磁力链接或种子文件。</div>}
      {searched && !searching && !results.length && !error && <div className="resource-empty">没有找到匹配的视频资源，可尝试英文剧名、具体季集或整季名称。</div>}
      <div className="resource-results">
        {results.map((result) => <article className="resource-card" key={result.id}>
          <div className="resource-card-main">
            <strong title={result.name}>{result.name}</strong>
            <small>{resourceSize(result.size)} · 做种 {result.seeders} · 下载 {result.leechers}{result.added > 0 ? ` · ${new Date(result.added).toLocaleDateString()}` : ''}</small>
          </div>
          <Button size="xs" variant="subtle" onClick={() => void api.openExternal(result.sourceUrl).catch((e) => setError(message(e)))}>来源</Button>
          <Button size="xs" onClick={() => void prepare(result.magnet)}>下载</Button>
        </article>)}
      </div>
    </> : <>
      <div className="resource-download-heading"><span title={settings?.directory}>保存位置：{settings?.directory ?? '正在读取…'}</span>
        <PlayerIconButton label="刷新" loading={refreshing} onClick={async () => {
          setRefreshing(true); try { await refresh() } catch (e) { setError(message(e)) } finally { setRefreshing(false) }
        }}><RefreshIcon /></PlayerIconButton>
      </div>
      {!shownTasks.length && <div className="resource-empty">{tab === 'completed' ? '还没有已完成的下载。' : '暂无下载任务，可从搜索结果添加。'}</div>}
      {shownTasks.map((task) => <article key={task.id} className="resource-task">
        <div className="resource-task-header">
          <strong title={task.name}>{task.name}</strong>
          <div className="resource-task-actions">
            {task.state !== 'initializing' && (!task.finished || settings?.seedAfterDownload) && <Button size="compact-xs" variant="subtle" disabled={busyTask !== null} onClick={() => void action(task.id, task.state === 'paused' || task.state === 'error' ? 'start' : 'pause')}>
              {task.state === 'paused' || task.state === 'error' ? task.finished ? '继续做种' : '继续' : '暂停'}
            </Button>}
            <Tooltip label="打开文件夹" openDelay={300} withArrow>
              <ActionIcon className="resource-task-icon" size={26} variant="subtle" color="gray" aria-label="打开文件夹" disabled={busyTask !== null} onClick={() => void api.resourceOpenFolder(task.id).catch((e) => setError(message(e)))}><FolderOpenIcon /></ActionIcon>
            </Tooltip>
            <Tooltip label="删除任务（保留已下载文件）" openDelay={300} withArrow>
              <ActionIcon className="resource-task-icon" size={26} variant="subtle" color="red" aria-label="删除任务" disabled={busyTask !== null} onClick={() => void action(task.id, 'forget')}><TrashIcon /></ActionIcon>
            </Tooltip>
          </div>
        </div>
        <div className="resource-task-progress">
          <progress aria-label={`${task.name} ${task.state === 'initializing' ? '本地校验进度' : '下载进度'}`} max={Math.max(1, task.total)} value={task.finished ? Math.max(1, task.total) : task.downloaded} />
          <div className="resource-task-status">
            <span>{task.state === 'initializing' ? isCompletedDownload(task) ? '已完成 · 正在校验本地文件' : '正在校验本地文件' : task.finished ? task.state === 'live' ? '做种中' : '已完成' : ({ live: task.downloadSpeed > 0 ? '下载中' : task.peers ? '已连接节点，等待数据' : '正在寻找节点', paused: '已暂停', error: '下载出错' })[task.state]}</span>
            <span>{task.state === 'initializing' ? '已校验 ' : ''}{resourceSize(task.downloaded)} / {resourceSize(task.total)}</span>
            {task.state !== 'initializing' && <>
              <span>↓ {resourceSize(task.downloadSpeed)}/s · ↑ {resourceSize(task.uploadSpeed)}/s</span>
              <span>节点 {task.peers}</span>
            </>}
          </div>
        </div>
        {task.state === 'live' && !task.finished && task.downloadSpeed === 0 && <p className="resource-note resource-task-note">
          已发现 {task.discoveredPeers ?? task.peers} 个节点 · 连接中 {task.connectingPeers ?? 0} · 连接失败 {task.failedPeers ?? 0}。
          {task.peers ? '已连接的节点暂未提供所选文件的数据。' : '正在通过 Tracker 和 DHT 寻找可用节点。'}
        </p>}
        {task.error && <p className="resource-error">{task.error}</p>}
        <details className="resource-files"><summary>文件列表（{task.files.filter((file) => file.selected).length}）</summary>
          {task.files.filter((file) => file.selected).map((file) => <div key={file.index} className="resource-file">
            <span title={file.name}>{file.name}</span><small>{resourceSize(file.size)}</small>
            {isVideo(file.name) && <PlayerIconButton className="resource-file-play" label={task.state === 'initializing' ? '校验后播放' : file.completed ? '播放' : '下载后播放'} disabled={task.state === 'initializing' || !file.completed || busyTask !== null} loading={busyTask === task.id} onClick={() => void play(task.id, file.index)}><PlayIcon /></PlayerIconButton>}
          </div>)}
        </details>
      </article>)}
    </>}

    <Modal opened={magnetOpen} onClose={() => setMagnetOpen(false)} title="添加磁力链接" centered>
      <TextInput aria-label="磁力链接" placeholder="magnet:?xt=urn:btih:…" value={magnet} onChange={(event) => setMagnet(event.currentTarget.value)} />
      <div className="resource-modal-actions"><Button disabled={!magnet.trim()} onClick={() => void prepare(magnet)}>获取文件列表</Button></div>
    </Modal>

    <Modal opened={previewOpen} onClose={closePreview} title="选择下载文件" centered size="lg" closeOnClickOutside={!adding} withCloseButton={!adding}>
      {preparing ? <div className="resource-preparing"><Loader size="sm" /><p>正在获取文件列表，磁力链接可能需要等待节点响应…</p></div> : preview && <>
        <strong>{preview.name}</strong>
        <div className="resource-directory"><span>{settings?.directory}</span><Button size="compact-xs" variant="subtle" disabled={adding} onClick={() => void chooseDirectory()}>更改位置</Button></div>
        <div className="resource-selection-actions">
          <button type="button" disabled={adding} onClick={() => setSelected(preview.files.filter((file) => isVideo(file.name)).map((file) => file.index))}>只选视频</button>
          <button type="button" disabled={adding} onClick={() => setSelected(preview.files.map((file) => file.index))}>全选</button>
          <button type="button" disabled={adding} onClick={() => setSelected([])}>清空</button>
        </div>
        <div className="resource-file-picker">{preview.files.map((file) => <div className="resource-file" key={file.index}>
          <Checkbox label={file.name} checked={selected.includes(file.index)} disabled={adding} onChange={(event) => setSelected(event.currentTarget.checked ? [...selected, file.index] : selected.filter((index) => index !== file.index))} />
          <small>{resourceSize(file.size)}</small>
        </div>)}</div>
        <p className="resource-note">已选 {selected.length} 个文件，共 {resourceSize(preview.files.filter((file) => selected.includes(file.index)).reduce((total, file) => total + file.size, 0))}</p>
      </>}
      {error && <p role="alert" className="resource-error">{error}</p>}
      <div className="resource-modal-actions"><Button variant="subtle" disabled={adding} onClick={closePreview}>取消</Button>
        {!preparing && <Button loading={adding} disabled={!preview || !selected.length} onClick={() => void add()}>开始下载</Button>}
      </div>
    </Modal>

    <Modal opened={settingsOpen} onClose={() => { if (!saving) setSettingsOpen(false) }} title="下载设置" centered>
      {draft && <div className="resource-settings">
        <div className="resource-directory"><span>{settings?.directory}</span><Button size="compact-xs" variant="subtle" onClick={() => void chooseDirectory()}>更改位置</Button></div>
        <NumberInput label="下载限速（KB/s，0 为不限速）" min={0} max={1000000} allowDecimal={false} value={draft.downloadLimitKB} onChange={(value) => setDraft({ ...draft, downloadLimitKB: Number(value) || 0 })} />
        <NumberInput label="上传限速（KB/s，0 为不限速）" min={0} max={1000000} allowDecimal={false} value={draft.uploadLimitKB} onChange={(value) => setDraft({ ...draft, uploadLimitKB: Number(value) || 0 })} />
        <Checkbox label="下载完成后继续做种" checked={draft.seedAfterDownload} onChange={(event) => setDraft({ ...draft, seedAfterDownload: event.currentTarget.checked })} />
        <p className="resource-note">非零限速至少为 64 KB/s。搜索沿用应用代理；P2P 支持 SOCKS5 代理，HTTP 代理不用于 P2P。</p>
        <p className="resource-note">下载过程中也可能上传已有分片。关闭应用会停止任务；再次打开资源页后可继续。</p>
        <Button loading={saving} onClick={async () => {
          setSaving(true); setError('')
          try {
            const saved = await api.resourceConfigure({ downloadLimitKB: draft.downloadLimitKB, uploadLimitKB: draft.uploadLimitKB, seedAfterDownload: draft.seedAfterDownload })
            setSettings(saved); setSettingsOpen(false)
          } catch (e) { setError(message(e)) } finally { setSaving(false) }
        }}>保存</Button>
        {error && <p role="alert" className="resource-error">{error}</p>}
      </div>}
    </Modal>
  </PageShell>
}
