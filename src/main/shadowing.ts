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
    const r = await fetchFn(en.baseUrl + (en.baseUrl.includes('?') ? '&' : '?') + 'fmt=json3')
    const cues = parseCaptionText(await r.text())
    if (cues.length === 0) return null
    return { title: pr.videoDetails?.title ?? '', cues }
  } catch {
    return null
  }
}

/** 提炼 prompt：带序号的 cue 列表交给 LLM 精选并清洗（去口头禅/填充词） */
export function buildShadowingMessages(cues: Cue[]): ChatMessage[] {
  const numbered = cues.map((c, i) => `${i}. ${c.text}`).join('\n')
  return [
    {
      role: 'system',
      content:
        '你是英语口语教材编辑。用户会给你一段 YouTube 视频的英文字幕（每行带序号）。' +
        '请挑选 8-15 句适合口语跟读练习的句子，输出 JSON 数组，格式 [{"i": 起始序号, "text": "清洗后的句子"}]。规则：' +
        '1) 选语法完整、日常实用的句子，可跨越多个连续字幕（i 取起始字幕序号）；' +
        '2) 删除填充词（um, uh, you know, I mean 等）、口头禅和自我纠正；' +
        '3) 尽量保留原句用词，不改写意思；' +
        '4) 句子保持在 4-25 个单词；' +
        '5) 只输出 JSON 数组，不要任何解释。'
    },
    { role: 'user', content: numbered }
  ]
}

/** 防御性解析 LLM 输出：找出第一个 JSON 数组，校验 i/text，去重排序，最多 20 条 */
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
  return out.sort((a, b) => a.i - b.i).slice(0, 20)
}
