/**
 * 从 ECDICT (stardict.csv) 构建精简本地词典 resources/dict.json
 * 用法：npm run build:dict
 * 下载失败时写入一个最小内置词表，保证应用仍可离线工作。
 */
import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, '..', 'resources', 'dict.json')
const URL_CSV = 'https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv'
// COCA 词频排名阈值：只保留前 8 万常用词
const FRQ_LIMIT = 80000

const FALLBACK = {
  hello: { p: "hə'ləʊ", t: '你好' },
  world: { p: 'wɜːld', t: '世界' },
  learn: { p: 'lɜːn', t: '学习' },
  english: { p: "'ɪŋɡlɪʃ", t: '英语；英语的' },
  video: { p: "'vɪdiəʊ", t: '视频' },
  word: { p: 'wɜːd', t: '单词' },
  language: { p: "'læŋɡwɪdʒ", t: '语言' },
  subtitle: { p: "'sʌbtaɪtl", t: '字幕' },
  translate: { p: 'trænsˈleɪt', t: '翻译' },
  favorite: { p: "'feɪvərɪt", t: '收藏；最喜欢的' }
}

function download(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
          res.resume()
          resolve(download(res.headers.location, redirects - 1))
          return
        }
        if (res.statusCode !== 200) {
          res.resume()
          reject(new Error(`HTTP ${res.statusCode}`))
          return
        }
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      })
      .on('error', reject)
  })
}

/** 解析一行 CSV（处理引号包裹字段） */
function parseCsvLine(line) {
  const fields = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuote) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuote = false
        }
      } else {
        cur += c
      }
    } else if (c === '"') {
      inQuote = true
    } else if (c === ',') {
      fields.push(cur)
      cur = ''
    } else {
      cur += c
    }
  }
  fields.push(cur)
  return fields
}

async function main() {
  let csv
  try {
    console.log('下载 ECDICT stardict.csv …')
    csv = await download(URL_CSV)
    console.log(`下载完成，${(csv.length / 1024 / 1024).toFixed(1)}MB`)
  } catch (e) {
    console.error('下载失败，写入最小内置词表：', e.message)
    fs.mkdirSync(path.dirname(OUT), { recursive: true })
    fs.writeFileSync(OUT, JSON.stringify(FALLBACK, null, 2), 'utf8')
    return
  }

  const lines = csv.split('\n')
  const header = parseCsvLine(lines[0])
  const idx = Object.fromEntries(header.map((h, i) => [h, i]))
  const dict = {}
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    const f = parseCsvLine(line)
    const word = (f[idx.word] || '').trim().toLowerCase()
    if (!/^[a-z][a-z'-]*$/.test(word)) continue
    const frq = Number(f[idx.frq] || 0)
    if (!frq || frq > FRQ_LIMIT) continue
    const t = (f[idx.translation] || f[idx.definition] || '')
      .split('\\n')
      .join('; ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!t) continue
    // f = COCA 词频排名（难度估算用；缺省不写字段）
    dict[word] = { p: (f[idx.phonetic] || '').trim() || undefined, t, f: frq }
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(dict), 'utf8')
  console.log(`已生成 ${OUT}，共 ${Object.keys(dict).length} 词`)
}

main()
