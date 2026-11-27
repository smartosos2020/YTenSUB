import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { repairTrackerlessSession, RESOURCE_TRACKERS, torrentIdentity, withFallbackTrackers } from '../src/main/resource-trackers'

describe('资源 Tracker 修复', () => {
  it('直接读取原始 info 哈希，识别公有和私有种子', () => {
    const info = Buffer.from('d4:name4:demoe')
    const publicTorrent = Buffer.concat([Buffer.from('d4:info'), info, Buffer.from('e')])
    expect(torrentIdentity(publicTorrent)).toEqual({ hash: createHash('sha1').update(info).digest('hex'), private: false })
    expect(torrentIdentity(Buffer.from('d4:infod4:name4:demo7:privatei1eee')).private).toBe(true)
    expect(() => torrentIdentity(Buffer.from('d4:infod4:name100:demoee'))).toThrow()
    expect(() => torrentIdentity(Buffer.from('d4:infod7:privatei0e7:privatei1eee'))).toThrow()
  })

  it('迁移旧公有任务的空 Tracker，保留暂停状态、路径、文件选择及原始种子', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ytensub-trackers-'))
    const torrent = Buffer.from('d4:infod4:name4:demoee')
    const hash = torrentIdentity(torrent).hash
    const filename = path.join(directory, 'session.json')
    const task = { info_hash: hash, trackers: [], output_folder: 'H:\\mv\\demo', is_paused: true, only_files: [2] }
    fs.writeFileSync(filename, JSON.stringify({ torrents: { 0: task } }))
    fs.writeFileSync(path.join(directory, hash + '.torrent'), torrent)
    expect(repairTrackerlessSession(directory)).toBe(1)
    expect(JSON.parse(fs.readFileSync(filename, 'utf8')).torrents[0]).toEqual({ ...task, trackers: RESOURCE_TRACKERS })
    expect(JSON.parse(fs.readFileSync(filename + '.trackers-backup', 'utf8')).torrents[0]).toEqual(task)
    const repairedTorrent = fs.readFileSync(path.join(directory, hash + '.torrent'))
    expect(torrentIdentity(repairedTorrent)).toEqual(torrentIdentity(torrent))
    expect(repairedTorrent.includes(Buffer.from(RESOURCE_TRACKERS[0]))).toBe(true)
    expect(fs.readFileSync(path.join(directory, hash + '.torrent.trackers-backup'))).toEqual(torrent)
    expect(repairTrackerlessSession(directory)).toBe(0)
  })

  it('保留原有 Tracker 和私有种子，补入 Tracker 时保留 info 原始字节', () => {
    const privateTorrent = Buffer.from('d4:infod4:name4:demo7:privatei1eee')
    expect(withFallbackTrackers(privateTorrent)).toBe(privateTorrent)
    const original = Buffer.from('d8:announce18:http://t/announce/4:infod4:name4:demoee')
    expect(withFallbackTrackers(original)).toBe(original)
    const publicTorrent = Buffer.from('d7:comment4:test4:infod4:name4:demoee')
    const patched = withFallbackTrackers(publicTorrent)
    expect(torrentIdentity(patched)).toEqual(torrentIdentity(publicTorrent))
    expect(patched.includes(Buffer.from('7:comment4:test'))).toBe(true)
  })

  it('不会给私有种子或哈希不符的元数据补公有 Tracker', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ytensub-private-trackers-'))
    const torrent = Buffer.from('d4:infod4:name4:demo7:privatei1eee')
    const hash = torrentIdentity(torrent).hash
    fs.writeFileSync(path.join(directory, hash + '.torrent'), torrent)
    fs.writeFileSync(path.join(directory, 'a'.repeat(40) + '.torrent'), torrent)
    const original = JSON.stringify({ torrents: { 0: { info_hash: hash, trackers: [] }, 1: { info_hash: 'a'.repeat(40), trackers: [] } } })
    fs.writeFileSync(path.join(directory, 'session.json'), original)
    expect(repairTrackerlessSession(directory)).toBe(0)
    expect(fs.readFileSync(path.join(directory, 'session.json'), 'utf8')).toBe(original)
  })
})
