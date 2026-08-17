/**
 * 端到端验证字幕提取链路：
 * 用真实 Electron 窗口加载 YouTube 视频页，执行 src/shared/extract.ts 里的
 * 同一份 EXTRACT_SCRIPT（与应用 webview 中运行的完全一致），打印结果。
 *
 * 用法：npx electron scripts/verify-extract.mjs [视频URL]
 */
import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const url = process.argv[2] || 'https://www.youtube.com/watch?v=aP9fXhqI6vI&t=14s'

// 用 esbuild 正确编译 TS 源（模板字符串里的转义序列需经编译才正确）
const require = createRequire(import.meta.url)
const esbuild = require('esbuild')
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'extract.ts'), 'utf8')
const js = esbuild.transformSync(src, { loader: 'ts', format: 'cjs' }).code
const mod = { exports: {} }
new Function('module', 'exports', js)(mod, mod.exports)
const script = mod.exports.EXTRACT_SCRIPT

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1280, height: 800 })
  try {
    await win.loadURL(url)
    let last = null
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 2000))
      last = await win.webContents.executeJavaScript(script)
      if (last?.ok) break
      console.log(`第 ${i + 1} 次尝试未就绪:`, JSON.stringify(last))
    }
    if (!last?.ok) {
      console.log('EXTRACT_FAILED', JSON.stringify(last))
      process.exitCode = 1
      return
    }
    const text = last.captionText ?? ''
    let count = 0
    let first = ''
    if (text.startsWith('{')) {
      const events = JSON.parse(text).events ?? []
      const cues = events.filter((e) => e.segs && e.segs.map((s) => s.utf8 || '').join('').trim())
      count = cues.length
      first = cues[0]?.segs.map((s) => s.utf8).join('').trim() ?? ''
    } else if (text.startsWith('<')) {
      const matches = [...text.matchAll(/<p\b[^>]*>[\s\S]*?<\/p>/g)]
      count = matches.length
      first = matches[0]?.[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() ?? ''
    }
    console.log(
      'EXTRACT_OK',
      JSON.stringify({
        videoId: last.videoId,
        title: last.title,
        channel: last.channel,
        hasCaptions: last.hasCaptions,
        captionError: last.captionError ?? null,
        captionBytes: text.length,
        cues: count
      })
    )
    if (first) console.log('首条字幕:', first)
  } catch (e) {
    try {
      const probe = await win.webContents.executeJavaScript(
        '({ title: document.title, href: location.href })'
      )
      console.log('VERIFY_ERROR', String(e), '| 页面状态:', JSON.stringify(probe))
    } catch {
      console.log('VERIFY_ERROR', String(e))
    }
    process.exitCode = 1
  } finally {
    app.quit()
  }
})
