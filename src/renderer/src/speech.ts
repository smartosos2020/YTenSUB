import { api } from './api'

/**
 * 朗读英文单词/短语：优先 dictionaryapi.dev 的真人发音（主进程查询音频 URL），
 * 失败/无音频时回退系统 TTS（Web Speech API，离线可用）。
 */
export function speakWord(text: string): void {
  const t = text.trim()
  if (!t) return
  void playRealVoice(t).then((ok) => {
    if (!ok) speakSystem(t)
  })
}

/**
 * 句子级示范音（跟读页"原声"）：当前为系统 TTS。
 * 预留 provider 链：LLM 语音模型（OpenAI 兼容 /audio/speech）成熟后作为顶级源接入，
 * 按句子文本哈希缓存音频，voice/model 变更时换 key 不串味。
 */
export function speakText(text: string): void {
  const t = text.trim()
  if (!t) return
  speakSystem(t)
}

async function playRealVoice(t: string): Promise<boolean> {
  try {
    const url = await api.dictPronounce(t)
    if (!url) return false
    const audio = new Audio(url)
    await audio.play()
    return true
  } catch {
    return false
  }
}

/** 系统 TTS 兜底；连点时打断上一次 */
function speakSystem(t: string): void {
  if (!('speechSynthesis' in window)) return
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(t)
  u.lang = 'en-US'
  u.rate = 0.9
  speechSynthesis.speak(u)
}
