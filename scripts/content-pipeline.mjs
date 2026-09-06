/**
 * 精选内容管线（Phase 0 单机版）运行器：
 * 把 src/main/curated-run.ts（TS）用 esbuild 打包成临时 cjs 再执行。
 *
 * 用法：npm run pipeline
 * 前置：项目根目录 .env 里有 YOUTUBE_API_KEY；resources/dict.json 已构建
 * 输出：%APPDATA%/YTenSUB/content-db.json
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

// .env 手工解析（不引依赖）
const envText = fs.existsSync(path.join(root, '.env'))
  ? fs.readFileSync(path.join(root, '.env'), 'utf8')
  : ''
const apiKey = /YOUTUBE_API_KEY=(\S+)/.exec(envText)?.[1]
if (!apiKey) {
  console.error('缺少 YOUTUBE_API_KEY：请在项目根目录 .env 写入 YOUTUBE_API_KEY=...')
  process.exit(1)
}

const dictPath = path.join(root, 'resources', 'dict.json')
if (!fs.existsSync(dictPath)) {
  console.error('缺少 resources/dict.json：先运行 npm run build:dict')
  process.exit(1)
}

const require2 = createRequire(import.meta.url)
const esbuild = require2('esbuild')
const outFile = path.join(root, 'node_modules', '.cache', 'curated-run.cjs')
esbuild.buildSync({
  entryPoints: [path.join(root, 'src', 'main', 'curated-run.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: outFile,
  logLevel: 'warning'
})

const { runCuratedPipeline } = require2(outFile)
const dbPath = path.join(process.env.APPDATA || os.homedir(), 'YTenSUB', 'content-db.json')

runCuratedPipeline({
  apiKey,
  dbPath,
  seedPath: path.join(root, 'scripts', 'seed-channels.json'),
  dictPath,
  fetchFn: (u, i) => fetch(u, i),
  onLog: (m) => console.log(m)
}).catch((e) => {
  console.error('管线失败：', e)
  process.exitCode = 1
})
