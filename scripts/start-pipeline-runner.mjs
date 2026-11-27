import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readContentEnv } from './content-api.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const env = readContentEnv()
if (!env.ADMIN_TOKEN || !env.YOUTUBE_API_KEY) throw new Error('请先配置 .env 中的 ADMIN_TOKEN 和 YOUTUBE_API_KEY')
const directory = path.join(env.APPDATA || os.homedir(), 'YTenSUB')
fs.mkdirSync(directory, { recursive: true })
const log = fs.openSync(path.join(directory, 'pipeline-runner.log'), 'a')
try {
  const child = spawn(process.execPath, [path.join(root, 'scripts', 'pipeline-runner.mjs')], {
    cwd: root, detached: true, windowsHide: true, shell: false, stdio: ['ignore', log, log]
  })
  child.on('error', error => { console.error(error.message); process.exitCode = 1 })
  child.unref()
} finally { fs.closeSync(log) }
console.log('已启动后台采集执行端，日志：' + path.join(directory, 'pipeline-runner.log'))
