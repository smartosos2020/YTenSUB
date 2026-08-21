/**
 * 验证反色滤镜主题联动：滤镜 <style> 的插入/摘除逻辑 + 截图确认观感
 * 用法：npx electron scripts/verify-theme.mjs
 */
import { app, BrowserWindow, nativeTheme } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'yt-theme-test-')))

const APPLY = (wantDark) => `(() => {
  const app = document.querySelector('ytd-app')
  const appBg = app ? getComputedStyle(app).backgroundColor : ''
  const pageDark = document.documentElement.hasAttribute('dark') || appBg === 'rgb(15, 15, 15)'
  const mismatch = pageDark !== ${wantDark}
  const ID = 'ytensub-theme-inv'
  let st = document.getElementById(ID)
  if (mismatch) {
    if (!st) {
      st = document.createElement('style')
      st.id = ID
      st.textContent =
        'html { filter: invert(1) hue-rotate(180deg) !important; }' +
        'video, img, canvas { filter: invert(1) hue-rotate(180deg) !important; }'
      document.documentElement.appendChild(st)
    }
  } else if (st) {
    st.remove()
  }
  return { pageDark, mismatch, stylePresent: !!document.getElementById(ID) }
})()`

const probeSafe = async (win, wantDark) => {
  try {
    return JSON.stringify(await win.webContents.executeJavaScript(APPLY(wantDark)))
  } catch (e) {
    return 'probe-failed: ' + String(e)
  }
}

async function shoot(win, name) {
  try {
    const img = await win.capturePage()
    const out = path.join(__dirname, name)
    fs.writeFileSync(out, img.toPNG())
    console.log('SCREENSHOT_SAVED', out)
  } catch (e) {
    console.log('CAPTURE_FAILED', name, String(e))
  }
}

app.whenReady().then(async () => {
  nativeTheme.themeSource = 'dark'
  const win = new BrowserWindow({ show: false, width: 1280, height: 800, x: 40, y: 40 })
  try {
    win.loadURL('https://www.youtube.com/').catch(() => {})
    await new Promise((r) => setTimeout(r, 8000))
    // 页面为暗，目标亮 → 应插入滤镜
    console.log('APPLY-LIGHT', await probeSafe(win, false))
    await shoot(win, 'theme-filter-light.png')
    // 页面为暗，目标暗 → 应摘除滤镜
    console.log('APPLY-DARK ', await probeSafe(win, true))
    await shoot(win, 'theme-filter-off.png')
  } catch (e) {
    console.log('VERIFY_ERROR', String(e))
    process.exitCode = 1
  } finally {
    app.quit()
  }
})
