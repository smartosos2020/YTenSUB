import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {
  AppData,
  Favorite,
  Folder,
  Settings,
  VocabItem,
  defaultData
} from '../shared/types'

/**
 * 单 JSON 文件存储，防抖 + 原子写入。
 * 不依赖 electron，方便单元测试（由 main/index.ts 传入 userData 路径）。
 */
export class Store {
  private data: AppData
  private file: string
  private timer: NodeJS.Timeout | null = null

  constructor(file: string) {
    this.file = file
    this.data = this.load()
  }

  private load(): AppData {
    try {
      const raw = fs.readFileSync(this.file, 'utf8')
      const parsed = JSON.parse(raw)
      const base = defaultData()
      return {
        ...base,
        ...parsed,
        settings: { ...base.settings, ...(parsed.settings ?? {}) }
      }
    } catch {
      return defaultData()
    }
  }

  private scheduleSave(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 300)
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = this.file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
    fs.renameSync(tmp, this.file)
  }

  // ---------- folders ----------
  listFolders(): Folder[] {
    return [...this.data.folders]
  }

  addFolder(name: string): Folder {
    const folder: Folder = { id: crypto.randomUUID(), name: name.trim() }
    this.data.folders.push(folder)
    this.scheduleSave()
    return folder
  }

  removeFolder(id: string): void {
    this.data.folders = this.data.folders.filter((f) => f.id !== id)
    for (const fav of this.data.favorites) {
      if (fav.folderId === id) fav.folderId = null
    }
    this.scheduleSave()
  }

  // ---------- favorites ----------
  listFavorites(folderId?: string | null): Favorite[] {
    if (folderId === undefined) return [...this.data.favorites]
    return this.data.favorites.filter((f) => f.folderId === folderId)
  }

  addFavorite(fav: Omit<Favorite, 'addedAt'>): Favorite {
    const existing = this.data.favorites.find((f) => f.videoId === fav.videoId)
    if (existing) {
      Object.assign(existing, fav)
      this.scheduleSave()
      return existing
    }
    const item: Favorite = { ...fav, addedAt: Date.now() }
    this.data.favorites.push(item)
    this.scheduleSave()
    return item
  }

  removeFavorite(videoId: string): void {
    this.data.favorites = this.data.favorites.filter((f) => f.videoId !== videoId)
    this.scheduleSave()
  }

  isFavorite(videoId: string): boolean {
    return this.data.favorites.some((f) => f.videoId === videoId)
  }

  // ---------- vocab ----------
  listVocab(): VocabItem[] {
    return [...this.data.vocab].sort((a, b) => b.addedAt - a.addedAt)
  }

  addVocab(item: Omit<VocabItem, 'id' | 'addedAt'>): VocabItem {
    const key = item.text.trim().toLowerCase()
    const existing = this.data.vocab.find((v) => v.text.trim().toLowerCase() === key)
    if (existing) {
      // 同词再次添加：更新翻译与来源信息，刷新时间
      Object.assign(existing, item, { addedAt: Date.now() })
      this.scheduleSave()
      return existing
    }
    const vocab: VocabItem = { ...item, id: crypto.randomUUID(), addedAt: Date.now() }
    this.data.vocab.push(vocab)
    this.scheduleSave()
    return vocab
  }

  removeVocab(id: string): void {
    this.data.vocab = this.data.vocab.filter((v) => v.id !== id)
    this.scheduleSave()
  }

  // ---------- settings ----------
  getSettings(): Settings {
    return this.data.settings
  }

  setSettings(patch: Partial<Settings>): Settings {
    this.data.settings = {
      ...this.data.settings,
      ...patch,
      llm: { ...this.data.settings.llm, ...(patch.llm ?? {}) }
    }
    this.scheduleSave()
    return this.data.settings
  }
}
