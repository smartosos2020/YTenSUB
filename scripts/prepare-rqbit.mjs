import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = path.join(root, 'resources', 'engines', 'rqbit.exe')
const sha256 = '9fb0c0dbe63ea7ca04611039e0244e570d115e79d3a0d4ac2bba22b9d80f3cbc'
const digest = (buffer) => createHash('sha256').update(buffer).digest('hex')
try {
  if (digest(await fs.readFile(target)) === sha256) process.exit(0)
} catch { /* Fetch the pinned engine on first build. */ }
console.log('Preparing rqbit 9.1.0 for Windows…')
const response = await fetch('https://github.com/ikatson/rqbit/releases/download/v9.1.0/rqbit.exe', {
  signal: AbortSignal.timeout(120_000)
})
if (!response.ok) throw new Error(`rqbit download failed: HTTP ${response.status}`)
const buffer = Buffer.from(await response.arrayBuffer())
if (digest(buffer) !== sha256) throw new Error('rqbit SHA-256 verification failed')
await fs.mkdir(path.dirname(target), { recursive: true })
await fs.writeFile(target + '.tmp', buffer)
await fs.rename(target + '.tmp', target)
console.log('rqbit ready (SHA-256 verified).')
