import fs from 'node:fs'

const config = fs.readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8')
const block = config.split('[[d1_databases]]')[1]?.split('[[')[0]
const id = /database_id\s*=\s*"([^"]+)"/.exec(block || '')?.[1]
if (!id || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) || /^0+(?:-0+)*$/.test(id)) {
  console.error('D1 database_id is not configured. Create ytensub-db, set its real ID, then apply migrations before deploying.')
  process.exitCode = 1
}
