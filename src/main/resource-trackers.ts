import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

// A small fallback set from ngosang/trackerslist. Mix TCP HTTP and UDP discovery.
// https://github.com/ngosang/trackerslist/blob/master/trackers_best.txt
export const RESOURCE_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'http://tracker.dler.org:6969/announce',
  'http://tracker.dler.com:6969/announce',
  'http://tracker.renfei.net:8080/announce'
] as const

type BValue = Buffer | number | BValue[] | { [key: string]: BValue }
function dictionary(value: BValue | undefined): value is { [key: string]: BValue } {
  return !!value && typeof value === 'object' && !Buffer.isBuffer(value) && !Array.isArray(value)
}

/** Keep raw top-level values so tracker repair never re-encodes the info dictionary. */
function readTorrent(buffer: Buffer): { identity: { hash: string; private: boolean }; root: Record<string, BValue>; fields: Map<string, { key: Buffer; value: Buffer }> } {
  let offset = 0, nodes = 0, infoStart = -1, infoEnd = -1
  const fields = new Map<string, { key: Buffer; value: Buffer }>()
  const read = (depth: number): BValue => {
    if (depth > 64 || ++nodes > 200_000 || offset >= buffer.length) throw new Error('无效种子元数据')
    const marker = buffer[offset++]
    if (marker === 105) {
      const end = buffer.indexOf(101, offset)
      const text = buffer.subarray(offset, end).toString()
      if (end < 0 || !/^-?\d+$/.test(text) || !Number.isSafeInteger(Number(text))) throw new Error('无效种子整数')
      offset = end + 1; return Number(text)
    }
    if (marker === 100 || marker === 108) {
      const list: BValue[] = [], dict: Record<string, BValue> = Object.create(null)
      while (buffer[offset] !== 101) {
        if (marker === 108) list.push(read(depth + 1))
        else {
          const keyStart = offset, key = read(depth + 1), keyEnd = offset
          if (!Buffer.isBuffer(key)) throw new Error('无效种子字典')
          const name = key.toString(), start = offset
          if (Object.hasOwn(dict, name)) throw new Error('种子字典键重复')
          dict[name] = read(depth + 1)
          if (depth === 0) fields.set(name, { key: buffer.subarray(keyStart, keyEnd), value: buffer.subarray(start, offset) })
          if (depth === 0 && name === 'info') { infoStart = start; infoEnd = offset }
        }
      }
      ++offset; return marker === 108 ? list : dict
    }
    --offset
    const colon = buffer.indexOf(58, offset), text = buffer.subarray(offset, colon).toString()
    const size = Number(text)
    if (colon < 0 || !/^\d+$/.test(text) || !Number.isSafeInteger(size) || colon + 1 + size > buffer.length) throw new Error('无效种子字符串')
    offset = colon + 1 + size
    return buffer.subarray(colon + 1, offset)
  }
  if (!buffer.length || buffer.length > 8 * 1024 * 1024) throw new Error('种子元数据大小无效')
  const root = read(0)
  if (offset !== buffer.length || !dictionary(root) || !dictionary(root.info) || infoStart < 0) throw new Error('种子缺少 info 字典')
  // Be conservative about non-standard privacy values.
  return { identity: { hash: createHash('sha1').update(buffer.subarray(infoStart, infoEnd)).digest('hex'), private: root.info.private !== undefined && root.info.private !== 0 }, root, fields }
}

export function torrentIdentity(buffer: Buffer): { hash: string; private: boolean } { return readTorrent(buffer).identity }

function metadataTrackers(root: Record<string, BValue>): string[] {
  const values: string[] = []
  const collect = (value: BValue | undefined): void => {
    if (Buffer.isBuffer(value)) {
      const text = value.toString()
      if (/^(?:https?|udp):\/\//.test(text)) values.push(text)
    } else if (Array.isArray(value)) value.forEach(collect)
  }
  collect(root.announce); collect(root['announce-list'])
  return [...new Set(values)]
}

/** rqbit restores from cached .torrent bytes, ignoring session.json's tracker list. */
export function withFallbackTrackers(buffer: Buffer, trackers: readonly string[] = RESOURCE_TRACKERS): Buffer {
  const parsed = readTorrent(buffer)
  if (parsed.identity.private || metadataTrackers(parsed.root).length || !trackers.length) return buffer
  const string = (value: string): Buffer => Buffer.from(`${Buffer.byteLength(value)}:${value}`)
  parsed.fields.set('announce', { key: string('announce'), value: string(trackers[0]) })
  parsed.fields.set('announce-list', { key: string('announce-list'), value: Buffer.concat([
    Buffer.from('l'), ...trackers.flatMap((tracker) => [Buffer.from('l'), string(tracker), Buffer.from('e')]), Buffer.from('e')
  ]) })
  return Buffer.concat([Buffer.from('d'), ...[...parsed.fields.entries()].sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b))).flatMap(([, { key, value }]) => [key, value]), Buffer.from('e')])
}

/** Run only before spawning rqbit; never edit a running engine's session. */
export function repairTrackerlessSession(directory: string, trackers: readonly string[] = RESOURCE_TRACKERS): number {
  if (!trackers.length) return 0
  const filename = path.join(directory, 'session.json')
  let original: string, session: { torrents?: Record<string, { info_hash?: string; trackers?: string[] }> }
  try { original = fs.readFileSync(filename, 'utf8'); session = JSON.parse(original) } catch { return 0 }
  let changed = 0
  for (const task of Object.values(session.torrents ?? {})) {
    if (!task || !/^[a-f0-9]{40}$/i.test(task.info_hash ?? '')) continue
    try {
      const torrentPath = path.join(directory, `${task.info_hash}.torrent`)
      if (fs.statSync(torrentPath).size > 8 * 1024 * 1024) continue
      const originalTorrent = fs.readFileSync(torrentPath)
      const identity = torrentIdentity(originalTorrent)
      if (identity.private || identity.hash !== task.info_hash) continue
      const repaired = withFallbackTrackers(originalTorrent, task.trackers?.length ? task.trackers : trackers)
      const changedTorrent = !repaired.equals(originalTorrent)
      const changedSession = !task.trackers?.length
      if (changedTorrent) {
        try { fs.writeFileSync(torrentPath + '.trackers-backup', originalTorrent, { flag: 'wx' }) } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        }
        fs.writeFileSync(torrentPath + '.tmp', repaired)
        fs.renameSync(torrentPath + '.tmp', torrentPath)
      }
      if (changedSession) task.trackers = metadataTrackers(readTorrent(repaired).root)
      if (changedTorrent || changedSession) ++changed
    } catch { /* Leave unreadable/private/malformed torrents untouched. */ }
  }
  if (!changed) return 0
  try { fs.writeFileSync(filename + '.trackers-backup', original, { flag: 'wx' }) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  fs.writeFileSync(filename + '.tmp', JSON.stringify(session))
  fs.renameSync(filename + '.tmp', filename)
  return changed
}
