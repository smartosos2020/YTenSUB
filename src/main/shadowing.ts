import { Cue, parseCaptionText } from '../shared/captions'
import { ChatMessage } from './translate'

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

// YouTube innertube 公开客户端 key（与 web 端一致，youtube-dl 同款，非机密）
const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8'

/**
 * 主进程侧拉取视频英文 cue：innertube ANDROID 客户端拿字幕轨地址，再取 json3 原文。
 * 与 guest 内 EXTRACT_SCRIPT 同一接口，用于不打开浏览页也能生成跟读脚本。
 */
export async function fetchEnglishCues(
  videoId: string,
  fetchFn: FetchLike
): Promise<{ title: string; cues: Cue[] } | null> {
  try {
    const res = await fetchFn(`https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: {
          client: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 34, hl: 'en' }
        },
        videoId
      })
    })
    const pr = (await res.json()) as {
      videoDetails?: { title?: string }
      captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: { baseUrl?: string; languageCode?: string; kind?: string }[] } }
    }
    const tracks = pr.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []
    // 优先人工英文字幕，其次自动生成（kind === 'asr'）
    const ens = tracks.filter((t) => (t.languageCode ?? '').toLowerCase().startsWith('en'))
    const en = ens.find((t) => t.kind !== 'asr') ?? ens[0]
    if (!en?.baseUrl) return null
    // baseUrl 已自带 fmt 参数（srv3 XML），原样抓取即可，parseCaptionText 自动判别 json3/XML；
    // 追加 fmt=json3 会产生重复 fmt 参数被 YouTube 拒掉
    const r = await fetchFn(en.baseUrl)
    const cues = parseCaptionText(await r.text())
    if (cues.length === 0) return null
    return { title: pr.videoDetails?.title ?? '', cues }
  } catch {
    return null
  }
}

/** 合并后的完整句子单元：起止秒 + 文本 */
export interface SentenceUnit {
  start: number
  end: number
  text: string
}

/**
 * 把碎片 cue 合并成完整句子：标点（.!?）结尾、两句间隔 > 1.5s、
 * 或累积超过 35 词时断句；ASR 无标点轨靠后两条规则兜底。
 * LLM 提炼在完整句上进行，效果远好于直接喂碎片 cue。
 */
export function mergeCuesToSentences(cues: Cue[]): SentenceUnit[] {
  const out: SentenceUnit[] = []
  let buf = ''
  let start = -1
  let end = 0
  const flush = (): void => {
    const text = buf.trim()
    if (text) out.push({ start, end, text })
    buf = ''
    start = -1
  }
  for (const c of cues) {
    const cueEnd = c.start + Math.max(c.dur, 0.4)
    // 时间间隔断句：先结算上一段，再并入当前 cue
    if (start >= 0 && c.start - end > 1.5) flush()
    if (start < 0) start = c.start
    buf = buf ? buf + ' ' + c.text : c.text
    end = cueEnd
    const words = buf.split(/\s+/).length
    if (/[.!?]["')"]?$/.test(buf.trim()) || words > 35) flush()
  }
  flush()
  return out
}

/** 提炼 prompt：合并后的完整句子（带序号）交给 LLM 精选并清洗（去口头禅/填充词） */
export function buildShadowingMessages(units: { text: string }[]): ChatMessage[] {
  const numbered = units.map((c, i) => `${i}. ${c.text}`).join('\n')
  return [
    {
      role: 'system',
      content:
        '你是英语口语教材编辑。用户会给你一段 YouTube 视频的英文台词（已合并为完整句子，每行带序号）。' +
        '请挑选适合口语跟读练习的内容，输出 JSON 数组，格式 [{"i": 序号, "text": "清洗后的句子"}]。规则：' +
        '1) 优先选择前后连贯的段落：连续 3-6 句构成一个场景，保持视频原有的叙事延续性，不要从全篇散落挑孤立金句；' +
        '2) 密度约每 2 分钟视频 8-12 句，总数不超过 50 句；' +
        '3) 删除填充词（um, uh, you know, I mean 等）、说话人反复出现的口头禅和自我纠正；' +
        '4) 尽量保留原句用词，不改写意思；句子保持 4-25 个单词；' +
        '5) 只输出 JSON 数组，不要任何解释。'
    },
    { role: 'user', content: numbered }
  ]
}

/** 给选中的句子分配场景号：序号连续为同一场景，断开则开启新场景 */
export function withSceneNumbers(picked: { i: number; text: string }[]): number[] {
  const scenes: number[] = []
  let scene = 0
  let prevI = -2
  for (const p of picked) {
    if (p.i !== prevI + 1) scene++
    scenes.push(scene)
    prevI = p.i
  }
  return scenes
}

/** 防御性解析 LLM 输出：找出第一个 JSON 数组，校验 i/text，去重排序，最多 40 条 */
export function parseShadowingResponse(
  raw: string,
  cueCount: number
): { i: number; text: string }[] {
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start === -1 || end <= start) return []
  let data: unknown
  try {
    data = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(data)) return []
  const seen = new Set<number>()
  const out: { i: number; text: string }[] = []
  for (const item of data) {
    const i = Number((item as { i?: unknown })?.i)
    const text = String((item as { text?: unknown })?.text ?? '').trim()
    if (!Number.isInteger(i) || i < 0 || i >= cueCount || !text || seen.has(i)) continue
    seen.add(i)
    out.push({ i, text })
  }
  return out.sort((a, b) => a.i - b.i).slice(0, 60)
}

// 语气填充词与常见口头禅（规则兜底用，覆盖通用情况，个性化口头禅只有 LLM 能抓）
const FILLER_RE = /\b(um+|uh+|er+|ah+|hmm+|huh+|you know|i mean|kind of|sort of|you see)\b,?/gi
const LEADING_FILLER_RE = /^(so|well|now|okay|ok|yeah|yes|right|alright|and|but)\b[,.!]?\s*/i

/** 清洗一条字幕文本：去填充词 + 规范化空白 + 循环剥掉开头连续口头禅 */
export function cleanShadowingText(text: string): string {
  let t = text.replace(FILLER_RE, '').replace(/\s+/g, ' ').trim()
  // 开头口头禅可能连续出现（"Well, okay, ..."），循环剥到不再变化
  let prev = ''
  while (prev !== t) {
    prev = t
    t = t.replace(LEADING_FILLER_RE, '').trim()
  }
  return t.replace(/\s+([,.!?;:'"])/g, '$1').trim()
}

/**
 * 本地规则兜底选句：清洗填充词后，挑 4-25 词的完整句，
 * 超过 max 条时按时间均匀抽样（覆盖整段视频而非只取开头）。质量不及 LLM，但免费离线。
 */
export function ruleBasedPick(units: { text: string }[], max = 20): { i: number; text: string }[] {
  const candidates: { i: number; text: string }[] = []
  units.forEach((c, i) => {
    const text = cleanShadowingText(c.text)
    const words = text.split(/\s+/).length
    if (words < 4 || words > 25) return
    if (!/[\p{L}].*[.!?]$|^[\p{L}].*[\p{L}]$/u.test(text)) return
    candidates.push({ i, text })
  })
  if (candidates.length <= max) return candidates
  // 均匀抽样
  const out: { i: number; text: string }[] = []
  for (let k = 0; k < max; k++) {
    out.push(candidates[Math.floor((k * candidates.length) / max)])
  }
  return out
}
