// 用给定 PNG 替换应用图标（经 Electron nativeImage 缩放，无第三方依赖）：
//  - resources/icon.png            256x256 窗口/任务栏图标（main/index.ts 引用，打进 asar）
//  - src/renderer/src/assets/icon.png  标题栏图标（同上内容）
//  - build/icon.png                512x512 参考/预览
//  - build/icon.ico                多尺寸，electron-builder 安装包图标
// 用法：node_modules/electron/dist/electron.exe scripts/replace-icon.mjs <source.png>
import { app, nativeImage } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const src = process.argv[2]
if (!src) {
  console.error('usage: electron scripts/replace-icon.mjs <source.png>')
  process.exit(1)
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// --- ICO 编码器（PNG 压缩条目，同 build-icon.mjs 的格式） ---
function encodeIcoFromPngs(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = 6 + images.length * 16
  const entries = images.map(({ size, png }) => {
    const e = Buffer.alloc(16)
    e[0] = size >= 256 ? 0 : size
    e[1] = size >= 256 ? 0 : size
    e.writeUInt16LE(1, 4)
    e.writeUInt16LE(32, 6)
    e.writeUInt32LE(png.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += png.length
    return e
  })
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)])
}

app.whenReady().then(() => {
  const img = nativeImage.createFromPath(src)
  if (img.isEmpty()) {
    console.error('无法读取源图片：' + src)
    app.exit(1)
    return
  }
  const resize = (size) =>
    img.resize({ width: size, height: size, quality: 'best' }).toPNG()

  mkdirSync(join(root, 'resources'), { recursive: true })
  mkdirSync(join(root, 'build'), { recursive: true })

  const png256 = resize(256)
  writeFileSync(join(root, 'resources', 'icon.png'), png256)
  writeFileSync(join(root, 'src', 'renderer', 'src', 'assets', 'icon.png'), png256)
  writeFileSync(join(root, 'build', 'icon.png'), resize(512))

  const sizes = [256, 128, 64, 48, 32, 24, 16]
  const images = sizes.map((size) => ({ size, png: resize(size) }))
  writeFileSync(join(root, 'build', 'icon.ico'), encodeIcoFromPngs(images))

  console.log('icon replaced:', src)
  app.exit(0)
})
