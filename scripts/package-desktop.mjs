import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { loadClientConfig, loadReleaseConfig } from './client-config.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const config = process.argv.includes('--official') ? loadReleaseConfig(root) : loadClientConfig('production', root)
const env = { ...process.env, YTENSUB_API_URL: config.apiUrl, YTENSUB_UPDATE_URL: config.updateUrl }

function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

if (!process.env.npm_execpath) throw new Error('Run this script using npm run dist or npm run dist:official')
run([process.env.npm_execpath, 'run', 'build'])
run([path.join(root, 'node_modules/electron-builder/cli.js'), '--config', 'electron-builder.config.cjs'])
