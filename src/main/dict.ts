import fs from 'node:fs'

export interface DictEntry {
  /** 音标 */
  p?: string
  /** 中文释义 */
  t: string
}

type DictMap = Record<string, DictEntry>

/**
 * 本地词典，懒加载 resources/dict.json。
 * 只处理单词；短语/句子返回 null，交给翻译链的下一级。
 */
export class Dict {
  private map: DictMap | null = null

  constructor(private file: string) {}

  private ensure(): DictMap {
    if (this.map === null) {
      try {
        this.map = JSON.parse(fs.readFileSync(this.file, 'utf8')) as DictMap
      } catch {
        this.map = {}
      }
    }
    return this.map
  }

  get size(): number {
    return Object.keys(this.ensure()).length
  }

  lookup(word: string): DictEntry | null {
    const map = this.ensure()
    const w = word.trim().toLowerCase()
    if (!/^[a-z][a-z'-]*$/.test(w)) return null
    return map[w] ?? this.lookupLemma(map, w)
  }

  /** 朴素的词形还原：复数 / 过去式 / 进行时，查不到交给 Google */
  private lookupLemma(map: DictMap, w: string): DictEntry | null {
    const candidates: string[] = []
    if (w.endsWith("'s")) candidates.push(w.slice(0, -2))
    if (w.length > 4 && w.endsWith('ies')) candidates.push(w.slice(0, -3) + 'y')
    if (w.length > 3 && w.endsWith('es')) candidates.push(w.slice(0, -2))
    if (w.length > 2 && w.endsWith('s')) candidates.push(w.slice(0, -1))
    if (w.length > 4 && w.endsWith('ied')) candidates.push(w.slice(0, -3) + 'y')
    if (w.length > 3 && w.endsWith('ed')) {
      candidates.push(w.slice(0, -2), w.slice(0, -1))
    }
    if (w.length > 4 && w.endsWith('ing')) {
      candidates.push(w.slice(0, -3), w.slice(0, -3) + 'e')
    }
    for (const c of candidates) {
      if (map[c]) return map[c]
    }
    return null
  }
}
