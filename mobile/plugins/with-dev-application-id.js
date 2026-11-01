const fs = require('node:fs/promises')
const path = require('node:path')
const { withAppBuildGradle, withDangerousMod } = require('expo/config-plugins')

/** Keep the debug client installable beside the standalone release app. */
function withDevApplicationId(config) {
  config = withAppBuildGradle(config, (modConfig) => {
    let contents = modConfig.modResults.contents
    if (!contents.includes('applicationIdSuffix ".dev"')) {
      const debugBuildType = /^([ \t]*)buildTypes\s*\{\s*\r?\n\1([ \t]*)debug\s*\{\s*$/m
      const match = contents.match(debugBuildType)
      if (!match) throw new Error('Could not find the debug build type in android/app/build.gradle')
      const indent = `${match[2]}    `
      contents = contents.replace(
        debugBuildType,
        `$&\n${indent}applicationIdSuffix ".dev"\n${indent}versionNameSuffix "-dev"`
      )
    }
    modConfig.modResults.contents = contents
    return modConfig
  })

  return withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const stringsPath = path.join(
        modConfig.modRequest.platformProjectRoot,
        'app', 'src', 'debug', 'res', 'values', 'strings.xml'
      )
      await fs.mkdir(path.dirname(stringsPath), { recursive: true })
      await fs.writeFile(
        stringsPath,
        '<resources>\n  <string name="app_name">YTenSUB Dev</string>\n</resources>\n',
        'utf8'
      )
      return modConfig
    }
  ])
}

module.exports = withDevApplicationId
