// Ordinary packaging has no update service. The release wrapper injects an explicit URL.
module.exports = {
  ...require('./package.json').build,
  publish: process.env.YTENSUB_UPDATE_URL
    ? [{ provider: 'generic', url: process.env.YTENSUB_UPDATE_URL, channel: 'latest' }]
    : null
}
