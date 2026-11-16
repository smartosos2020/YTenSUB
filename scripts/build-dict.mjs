/**
 * 从 ECDICT 构建 PC 和手机共用的离线词典
 * 用法：npm run build:dict
 * 也可传入本地 CSV：npm run build:dict -- path/to/ecdict.csv
 */
import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUTPUTS = [
  path.join(__dirname, '..', 'resources', 'dict.json'),
  path.join(__dirname, '..', 'mobile', 'assets', 'dict.json')
]
const URL_CSV = 'https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv'
// 任一语料库有排名即可收录，包括只出现在 BNC 的常见英式拼写。
const RANK_LIMIT = 80000

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
  const input = process.argv[2]
  const csv = input ? fs.readFileSync(input, 'utf8') : await download(URL_CSV)

  const lines = csv.split('\n')
  const header = parseCsvLine(lines[0])
  const idx = Object.fromEntries(header.map((h, i) => [h, i]))
  for (const field of ['word', 'phonetic', 'definition', 'translation', 'frq', 'bnc']) {
    if (!(field in idx)) throw new Error(`ECDICT CSV 缺少字段：${field}`)
  }
  const dict = Object.create(null)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    const f = parseCsvLine(line)
    const word = (f[idx.word] || '').trim().toLowerCase()
    if (!/^[a-z][a-z'-]*$/.test(word)) continue
    const frq = Number(f[idx.frq] || 0)
    const bnc = Number(f[idx.bnc] || 0)
    if (!(frq > 0 && frq <= RANK_LIMIT) && !(bnc > 0 && bnc <= RANK_LIMIT)) continue
    const t = (f[idx.translation] || f[idx.definition] || '')
      .split('\\n')
      .join('; ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!t) continue
    // f = COCA 词频排名（难度估算用；缺省不写字段）
    dict[word] = { p: (f[idx.phonetic] || '').trim() || undefined, t, f: frq > 0 ? frq : undefined }
  }

  const count = Object.keys(dict).length
  if (count === 0) throw new Error('ECDICT 没有可用词条，保留现有词典')
  const json = JSON.stringify(dict)
  for (const output of OUTPUTS) {
    fs.mkdirSync(path.dirname(output), { recursive: true })
    fs.writeFileSync(output, json, 'utf8')
    console.log(`已生成 ${output}，共 ${count} 词`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
