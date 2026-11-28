/** Inlined at build time; unconfigured development and redistribution builds do not update. */
export const UPDATE_URL = (process.env.YTENSUB_UPDATE_URL || '').replace(/\/+$/, '')
export const INSTALLER_URL = UPDATE_URL ? `${UPDATE_URL}/YTenSUB-Setup-latest.exe` : ''
