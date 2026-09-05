import { LlmSettings, TranslateResult, TranslateSource } from '../shared/types'

export type { TranslateResult }

export interface TranslateDeps {
  localLookup: (text: string) => { translation: string; phonetic?: string } | null
  googleTranslate: (text: string) => Promise<string | null>
  llmTranslate: (text: string) => Promise<string | null>
  /** 已启用的翻译源，数组顺序即优先级 */
  enabled: TranslateSource[]
}

/** 翻译链：按 enabled 顺序依次尝试，全部失败返回 null */
export async function translateText(
  text: string,
  deps: TranslateDeps
): Promise<TranslateResult | null> {
  const t = text.trim()
  if (!t) return null
  for (const src of deps.enabled) {
    try {
      if (src === 'local') {
        const hit = deps.localLookup(t)
        if (hit) return { text: t, translation: hit.translation, phonetic: hit.phonetic, source: 'local' }
      } else if (src === 'google') {
        const r = await deps.googleTranslate(t)
        if (r) return { text: t, translation: r, source: 'google' }
      } else if (src === 'llm') {
        const r = await deps.llmTranslate(t)
        if (r) return { text: t, translation: r, source: 'llm' }
      }
    } catch {
      // 某一级失败，继续下一级
    }
  }
  return null
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

/** Google 免费翻译接口（gtx 客户端），英译中 */
export async function googleTranslateFree(
  text: string,
  fetchFn: FetchLike
): Promise<string | null> {
  const url =
    'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=' +
    encodeURIComponent(text)
  const res = await fetchFn(url)
  if (!res.ok) return null
  const data = (await res.json()) as unknown
  const segments = (data as unknown[])?.[0]
  if (!Array.isArray(segments)) return null
  const out = segments
    .map((seg) => (Array.isArray(seg) ? String(seg[0] ?? '') : ''))
    .join('')
    .trim()
  return out || null
}

/** OpenAI 兼容 chat/completions 通用调用 */
export interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

export interface LlmChatResult {
  content: string | null
  /** 失败原因（未配置 / HTTP 状态码 / 网络异常），成功为 null */
  error: string | null
}

/** 带错误详情的 LLM 调用（需要诊断的场景用；静默回退场景继续用 llmChat） */
export async function llmChatDetailed(
  cfg: LlmSettings,
  messages: ChatMessage[],
  fetchFn: FetchLike,
  temperature = 0.2
): Promise<LlmChatResult> {
  if (!cfg.baseUrl || !cfg.apiKey || !cfg.model)
    return { content: null, error: 'LLM 未配置完整（baseUrl/apiKey/model）' }
  try {
    const res = await fetchFn(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`
      },
      body: JSON.stringify({ model: cfg.model, temperature, messages })
    })
    if (!res.ok) return { content: null, error: `HTTP ${res.status}` }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    const content = data.choices?.[0]?.message?.content?.trim()
    return content ? { content, error: null } : { content: null, error: '响应中没有内容' }
  } catch (e) {
    return { content: null, error: String(e) }
  }
}

export async function llmChat(
  cfg: LlmSettings,
  messages: ChatMessage[],
  fetchFn: FetchLike,
  temperature = 0.2
): Promise<string | null> {
  return (await llmChatDetailed(cfg, messages, fetchFn, temperature)).content
}

/** OpenAI 兼容 chat/completions 翻译 */
export async function llmTranslate(
  text: string,
  cfg: LlmSettings,
  fetchFn: FetchLike
): Promise<string | null> {
  return llmChat(
    cfg,
    [
      {
        role: 'system',
        content:
          '你是英译中翻译助手。用户会给你英语单词或短语，请只返回简洁的中文释义，不要解释、不要加引号。'
      },
      { role: 'user', content: text }
    ],
    fetchFn
  )
}

/** 语境释义：把单词所在的整句一起给 LLM，返回该词在此语境下的中文意思（熟词僻义场景） */
export async function llmContextualTranslate(
  word: string,
  sentence: string,
  cfg: LlmSettings,
  fetchFn: FetchLike
): Promise<string | null> {
  return llmChat(
    cfg,
    [
      {
        role: 'system',
        content:
          '你是英译中翻译助手。用户会给出一个英语句子和其中的一个单词。请只返回该单词在这个句子语境下的简洁中文释义，不要解释、不要加引号。'
      },
      { role: 'user', content: `句子：${sentence}\n单词：${word}` }
    ],
    fetchFn
  )
}

/** 收藏自动打标签：标题+频道+台词样本 → 从预设里选（最多 2 个），可补一个自定义。防御解析 JSON 数组 */
export async function llmTagFavorite(
  title: string,
  channel: string,
  sample: string,
  presets: string[],
  cfg: LlmSettings,
  fetchFn: FetchLike
): Promise<string[]> {
  const raw = await llmChat(
    cfg,
    [
      {
        role: 'system',
        content:
          `你是视频内容分类助手。根据视频标题、频道和台词样本，从预设标签中选最多 2 个最贴切的：${presets.join('、')}。` +
          '都不贴切时可给一个自定义短标签（2-4 字）。只返回 JSON 数组字符串，如 ["科技","访谈"]，不要任何解释。'
      },
      { role: 'user', content: `标题：${title}\n频道：${channel}\n台词样本：\n${sample}` }
    ],
    fetchFn
  )
  if (!raw) return []
  const s = raw.indexOf('[')
  const e = raw.lastIndexOf(']')
  if (s === -1 || e <= s) return []
  try {
    const arr = JSON.parse(raw.slice(s, e + 1)) as unknown
    if (!Array.isArray(arr)) return []
    return [...new Set(arr.map((x) => String(x).trim()).filter(Boolean))].slice(0, 3)
  } catch {
    return []
  }
}

/**
 * 以固定并发把一组文本逐条翻译，结果与输入等长对齐；单条失败或空白输入为 null。
 * 用于字幕整句中译：调用方（IPC handler）在 translateOne 里做缓存与翻译链。
 */
export async function translateBatch(
  texts: string[],
  translateOne: (text: string) => Promise<string | null>,
  concurrency = 4
): Promise<(string | null)[]> {
  const out: (string | null)[] = new Array(texts.length).fill(null)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < texts.length) {
      const i = next++
      const t = texts[i].trim()
      if (!t) continue
      try {
        out[i] = await translateOne(t)
      } catch {
        out[i] = null
      }
    }
  }
  const n = Math.max(1, Math.min(concurrency, texts.length))
  await Promise.all(Array.from({ length: n }, worker))
  return out
}
