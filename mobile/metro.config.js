const path = require('node:path')
const { createHash } = require('node:crypto')
const { getDefaultConfig } = require('expo/metro-config')

const projectRoot = __dirname
const config = getDefaultConfig(projectRoot)

// Environment values are inlined into shared source outside the Expo project root.
// Keep local/self-hosted/official transforms apart when the same checkout builds all three.
config.cacheVersion = `ytensub-api-${createHash('sha256')
  .update(process.env.EXPO_PUBLIC_YTENSUB_API_URL || 'http://127.0.0.1:8787')
  .digest('hex')}`

// The pure business rules live in src/shared and are imported by both clients.
config.watchFolders = [path.resolve(projectRoot, '../src/shared')]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(projectRoot, '../node_modules')
]

module.exports = config
