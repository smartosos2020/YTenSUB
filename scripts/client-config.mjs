import fs from 'node:fs'
import path from 'node:path'
import { parseEnv } from 'node:util'
import { loadEnv } from 'vite'

function serviceUrl(value, name) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must be an HTTP(S) URL without credentials, query or fragment`)
  }
  return url.href.replace(/\/+$/, '')
}

export function resolveClientConfig(env = {}) {
  return {
    apiUrl: serviceUrl(env.YTENSUB_API_URL || 'http://127.0.0.1:8787', 'YTENSUB_API_URL'),
    updateUrl: env.YTENSUB_UPDATE_URL ? serviceUrl(env.YTENSUB_UPDATE_URL, 'YTENSUB_UPDATE_URL') : ''
  }
}

export function loadClientConfig(mode, root) {
  return resolveClientConfig(loadEnv(mode, root, 'YTENSUB_'))
}

/** Explicit opt-in only. This ignored file is never loaded by normal dev/build/dist. */
export function loadReleaseConfig(root, env = process.env) {
  const filename = path.join(root, '.env.release.local')
  const values = { ...(fs.existsSync(filename) ? parseEnv(fs.readFileSync(filename, 'utf8')) : {}), ...env }
  if (!values.YTENSUB_API_URL || !values.YTENSUB_UPDATE_URL) {
    throw new Error('Official release requires YTENSUB_API_URL and YTENSUB_UPDATE_URL in .env.release.local or the environment')
  }
  const config = resolveClientConfig(values)
  if (![config.apiUrl, config.updateUrl].every(value => new URL(value).protocol === 'https:')) {
    throw new Error('Official release API and update URLs must use HTTPS')
  }
  return config
}
