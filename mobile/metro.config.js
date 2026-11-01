const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')

const projectRoot = __dirname
const config = getDefaultConfig(projectRoot)

// The pure business rules live in src/shared and are imported by both clients.
config.watchFolders = [path.resolve(projectRoot, '../src/shared')]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(projectRoot, '../node_modules')
]

module.exports = config
