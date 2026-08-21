/**
 * 可见窗口对照实验：注入前 / 注入后 / 滚动后 各截一张
 * 用法：npx electron scripts/verify-scrollbar.mjs
 */
import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const STD_CSS =
  'html, body { scrollbar-width: thin !important; scrollbar-color: #4a514d transparent !important; }'
const WEBKIT_CSS =
  'html, body { scrollbar-color: auto !important; scrollbar-width: auto !important; }' +
  '::-webkit-scrollbar { width: 5px !important; height: 5px !important; }' +
  '::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: transparent !important; }' +
  '::-webkit-scrollbar-thumb { background: #333837 !important; border-radius: 999px !important; border: none !important; }' +
  '::-webkit-scrollbar-thumb:hover { background: #4a514d !important; }'

async function shoot(win, name) {
  const img = await win.capturePage()
  const out = path.join(__dirname, name)
  fs.writeFileSync(out, img.toPNG())
  console.log('SCREENSHOT_SAVED', out)
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, width: 1280, height: 800, x: 40, y: 40 })
  try {
    await win.loadURL('https://www.youtube.com/')
    await new Promise((r) => setTimeout(r, 4000))
    await shoot(win, 'sb-vis-before.png')
    await win.webContents.insertCSS(STD_CSS + WEBKIT_CSS)
    await new Promise((r) => setTimeout(r, 800))
    await shoot(win, 'sb-vis-after.png')
    await win.webContents.executeJavaScript('window.scrollBy(0, 800)')
    await new Promise((r) => setTimeout(r, 800))
    await shoot(win, 'sb-vis-scrolled.png')
  } catch (e) {
    console.log('VERIFY_ERROR', String(e))
    process.exitCode = 1
  } finally {
    app.quit()
  }
})
