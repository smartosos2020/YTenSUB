import { execFile } from 'node:child_process'
import http from 'node:http'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

it('runs legacy import through bounded authenticated pages without logging its token', async () => {
  const requested: string[] = []
  const progress = { users: 0, cards: 0 }
  const server = http.createServer(async (req, res) => {
    if (req.url !== '/admin/migrate/legacy' || req.headers.authorization !== 'Bearer test-import-secret') {
      res.writeHead(401).end('{}')
      return
    }
    let body = ''
    for await (const chunk of req) body += chunk
    const { kind } = JSON.parse(body) as { kind: 'users' | 'cards' }
    requested.push(kind)
    const scanned = ++progress[kind] * 20
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ scanned, complete: progress[kind] === 2 }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address() as { port: number }
    const output = await promisify(execFile)(process.execPath, [
      path.resolve('server/scripts/migrate-legacy.mjs'), '--base-url', `http://127.0.0.1:${address.port}`
    ], { env: { ...process.env, ADMIN_TOKEN: 'test-import-secret' }, timeout: 5000 })
    expect(requested).toEqual(['users', 'users', 'cards', 'cards'])
    expect(output.stdout).toContain('users: checked 40, complete')
    expect(output.stdout).toContain('cards: checked 40, complete')
    expect(output.stdout + output.stderr).not.toContain('test-import-secret')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
