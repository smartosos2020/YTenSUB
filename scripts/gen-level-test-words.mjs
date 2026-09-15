/**
 * 一次性脚本：从 resources/dict.json 生成词汇量定级向导的词表。
 * 运行：node scripts/gen-level-test-words.mjs
 * 产出：src/shared/level-test-words.json（随仓库分发，双端共用）
 *
 * 采样策略：按 COCA 词频排名 f 分 6 档（对应 A1–C2），每档取 4 个词，
 * 词按 f 升序后取 1/8、3/8、5/8、7/8 分位（确定性，避免每次生成换词）。
 * 只收 4–12 位纯小写字母单词（过滤缩写/专名/带符号词条）。
 */
import fs from 'node:fs'

const BANDS = [
  { level: 'A1', min: 1, max: 500 },
  { level: 'A2', min: 501, max: 1500 },
  { level: 'B1', min: 1501, max: 3000 },
  { level: 'B2', min: 3001, max: 6000 },
  { level: 'C1', min: 6001, max: 10000 },
  { level: 'C2', min: 10001, max: 20000 }
]

const dict = JSON.parse(fs.readFileSync('resources/dict.json', 'utf8'))
const words = Object.entries(dict)
  .filter(([w, e]) => /^[a-z]{4,12}$/.test(w) && Number.isFinite(e?.f) && e.f > 0)
  .map(([w, e]) => ({ w, f: e.f }))
  .sort((a, b) => a.f - b.f)

const out = []
for (const b of BANDS) {
  const inBand = words.filter((x) => x.f >= b.min && x.f <= b.max)
  for (const q of [1 / 8, 3 / 8, 5 / 8, 7 / 8]) {
    const pick = inBand[Math.floor(inBand.length * q)]
    if (pick) out.push(pick)
  }
  console.log(`${b.level}: 档内 ${inBand.length} 词`)
}

fs.writeFileSync('src/shared/level-test-words.json', JSON.stringify(out, null, 2) + '\n')
console.log(`生成 ${out.length} 词 → src/shared/level-test-words.json`)
