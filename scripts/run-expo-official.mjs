import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { loadReleaseConfig } from './client-config.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { apiUrl } = loadReleaseConfig(root)
const result = spawnSync(process.execPath, [path.join(root, 'mobile/node_modules/expo/bin/cli'), ...process.argv.slice(2)], {
  cwd: path.join(root, 'mobile'),
  env: { ...process.env, EXPO_PUBLIC_YTENSUB_API_URL: apiUrl },
  stdio: 'inherit'
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1
