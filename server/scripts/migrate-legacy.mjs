import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: { 'base-url': { type: 'string' }, help: { type: 'boolean' } } })
if (values.help) {
  console.log('npm run db:import -- --base-url https://your-worker.example (ADMIN_TOKEN required)')
  process.exit(0)
}

// Reuse the same local configuration as the pipeline, without printing credentials.
const envFile = fileURLToPath(new URL('../../.env', import.meta.url))
const config = {}
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (match) config[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
  }
}

async function main() {
  const base = new URL(values['base-url'] || process.env.AUTH_API_URL || config.AUTH_API_URL)
  if (base.username || base.password || base.search || base.hash ||
      (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))) {
    throw new Error('Use an HTTPS Worker URL, or HTTP localhost for local migration.')
  }
  const token = process.env.ADMIN_TOKEN || config.ADMIN_TOKEN
  if (!token) throw new Error('Missing ADMIN_TOKEN in environment or project .env')
  for (const kind of ['users', 'cards']) {
    while (true) {
      const response = await fetch(new URL('/admin/migrate/legacy', base), {
        method: 'POST', redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind }), signal: AbortSignal.timeout(30_000)
      })
      const result = await response.json()
      if (!response.ok) throw new Error(`Migration failed (HTTP ${response.status}): ${result.error || 'retry later'}`)
      if (typeof result.complete !== 'boolean' || !Number.isSafeInteger(result.scanned)) {
        throw new Error('Unexpected migration response; no further pages requested')
      }
      console.log(`${kind}: checked ${result.scanned}${result.complete ? ', complete' : ''}`)
      if (result.complete) break
    }
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1 })
