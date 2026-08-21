// Generate the app icon: flat gray/white YouTube-style play button.
// Outputs:
//  - build/icon.png     512x512 reference/preview
//  - build/icon.ico     multi-size, picked up by electron-builder (exe/installer icon)
//  - resources/icon.png 256x256 window/taskbar icon, referenced by src/main/index.ts
//    (resources/** is packaged into app.asar, so the same relative path works dev & packaged)
// Pure Node, no dependencies (SDF rasterization + PNG/ICO encoding).

import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Geometry on a 1x1 canvas (y grows downward).
const RECT = { x: 0.1, y: 0.225, w: 0.8, h: 0.55, r: 0.12 };
const TRI = [
  [0.45, 0.385], // top-left
  [0.45, 0.615], // bottom-left
  [0.64, 0.5], // right apex
];
const GRAY = [0x6e, 0x6e, 0x6e];
const WHITE = [0xff, 0xff, 0xff];

function sdRoundedBox(px, py) {
  const cx = RECT.x + RECT.w / 2;
  const cy = RECT.y + RECT.h / 2;
  const qx = Math.abs(px - cx) - (RECT.w / 2 - RECT.r);
  const qy = Math.abs(py - cy) - (RECT.h / 2 - RECT.r);
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
    Math.min(Math.max(qx, qy), 0) -
    RECT.r
  );
}

function sdSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(
    0,
    Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)),
  );
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function sdTriangle(px, py) {
  const [a, b, c] = TRI;
  const d = Math.min(
    sdSegment(px, py, a[0], a[1], b[0], b[1]),
    sdSegment(px, py, b[0], b[1], c[0], c[1]),
    sdSegment(px, py, c[0], c[1], a[0], a[1]),
  );
  const cross = (p, q, r) =>
    (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
  const p = [px, py];
  const s1 = cross(a, b, p);
  const s2 = cross(b, c, p);
  const s3 = cross(c, a, p);
  const inside =
    (s1 <= 0 && s2 <= 0 && s3 <= 0) || (s1 >= 0 && s2 >= 0 && s3 >= 0);
  return inside ? -d : d;
}

function render(size) {
  const buf = Buffer.alloc(size * size * 4);
  const coverage = (d) => Math.max(0, Math.min(1, 0.5 - d * size));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = (x + 0.5) / size;
      const py = (y + 0.5) / size;
      const bgA = coverage(sdRoundedBox(px, py));
      const fgA = coverage(sdTriangle(px, py));
      const a = fgA + bgA * (1 - fgA);
      if (a <= 0) continue;
      const i = (y * size + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        buf[i + ch] = Math.round(
          (WHITE[ch] * fgA + GRAY[ch] * bgA * (1 - fgA)) / a,
        );
      }
      buf[i + 3] = Math.round(a * 255);
    }
  }
  return buf;
}

// --- PNG encoding ---
const crcTable = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c;
}
function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- ICO encoding (PNG-compressed entries) ---
function encodeIco(sizes) {
  const images = sizes.map((size) => ({ size, png: encodePng(size, render(size)) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, png }) => {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

const outDir = join(root, 'build');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'icon.png'), encodePng(512, render(512)));
writeFileSync(join(outDir, 'icon.ico'), encodeIco([256, 128, 64, 48, 32, 24, 16]));
const resDir = join(root, 'resources');
mkdirSync(resDir, { recursive: true });
writeFileSync(join(resDir, 'icon.png'), encodePng(256, render(256)));
console.log('wrote build/icon.png, build/icon.ico, resources/icon.png');
