import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, VOCAB_CHANGED_EVENT } from '../api'
import { speakText } from '../speech'
import { playGuestSegment } from '../guest-audio'
import { MASTERED_LEVEL, ShadowingScript, VocabItem } from '../../../shared/types'
import WordSpans from '../components/WordSpans'
import TranslatePopup from '../components/TranslatePopup'
import { WordSelection } from '../components/SubtitlePanel'
import BackIcon from '../components/icons/BackIcon'
import PageShell from '../components/PageShell'
import bgmUrl from '../assets/bgm.mp3'

/** 每句预估朗读时长（秒）：按词数估算，下限 2.5s；播放调速在此基础上缩放 */
function estDuration(text: string): number {
  const words = text.trim().split(/\s+/).length
  return Math.max(2.5, words / 2.4)
}

/**
 * 跟读练习页：提词器式播放器。
 * 播放 = 脚本按预估时长自动滚动（速度可调）；原声 = 系统 TTS 朗读当前句（发音参考）；
 * BGM 独立循环播放，不受调速影响。currentTime 抽象为 position，
 * 将来接入音轨（LLM 语音）时只需把 position 的时间源换成 audio.currentTime。
 */
export default function ShadowingPage(): JSX.Element {
  const [searchParams] = useSearchParams()
  const videoId = searchParams.get('v') ?? ''
  const navigate = useNavigate()

  const [script, setScript] = useState<ShadowingScript | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [position, setPosition] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [bgmOn, setBgmOn] = useState(true)
  // 原声开关：按下常开，播放时每滚到一句自动读该句；与播放/暂停/停止互不干扰
  const [voiceOn, setVoiceOn] = useState(false)
  // 中文行开关：默认显示
  const [showZh, setShowZh] = useState(true)
  // 生词高亮与取词弹窗
  const [vocabList, setVocabList] = useState<VocabItem[]>([])
  const [selection, setSelection] = useState<WordSelection | null>(null)
  const bgmRef = useRef<HTMLAudioElement | null>(null)
  const speedRef = useRef(speed)
  speedRef.current = speed

  useEffect(() => {
    setLoaded(false)
    setScript(null)
    setPosition(0)
    setPlaying(false)
    if (!videoId) {
      setLoaded(true)
      return
    }
    void api.shadowingGet(videoId).then((s) => {
      setScript((s as ShadowingScript | null) ?? null)
      setLoaded(true)
    })
  }, [videoId])

  // 每句的起始时间（秒）与总时长
  const { starts, total } = useMemo(() => {
    const items = script?.items ?? []
    const starts: number[] = []
    let acc = 0
    for (const it of items) {
      starts.push(acc)
      acc += estDuration(it.text)
    }
    return { starts, total: acc }
  }, [script])

  const currentIdx = useMemo(() => {
    const items = script?.items ?? []
    if (items.length === 0) return -1
    for (let i = 0; i < items.length; i++) {
      if (position < starts[i] + estDuration(items[i].text)) return i
    }
    return items.length - 1
  }, [position, starts, script])

  // 播放推进：100ms 步进，播完自动停止并回到开头
  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => {
      setPosition((p) => {
        const next = p + 0.1 * speedRef.current
        if (next >= total) {
          setPlaying(false)
          return total
        }
        return next
      })
    }, 100)
    return () => clearInterval(timer)
  }, [playing, total])

  // 当前句滚动到可视区中央
  useEffect(() => {
    if (currentIdx < 0) return
    document
      .querySelector('.shadow-line.active')
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [currentIdx])

  // BGM：独立于脚本滚动，仅随播放/开关状态启停
  useEffect(() => {
    const bgm = bgmRef.current
    if (!bgm) return
    bgm.volume = 0.22
    if (playing && bgmOn) void bgm.play().catch(() => {})
    else bgm.pause()
  }, [playing, bgmOn])

  /** 原声：raw 脚本（原始字幕）播放视频对应片段；其余策略的脚本是清洗过的文本，走 TTS 示范音 */
  const speakCurrent = useCallback((): void => {
    if (currentIdx < 0 || !script) return
    const it = script.items[currentIdx]
    if (script.generatedBy === 'raw' && playGuestSegment(script.videoId, it.start, it.dur)) {
      return
    }
    speakText(it.text)
  }, [currentIdx, script])

  // 原声常开时：播放中每滚到一句自动读该句（切换句子/开关/播放状态变化都会触发）
  useEffect(() => {
    if (voiceOn && playing) speakCurrent()
  }, [voiceOn, playing, speakCurrent])

  // 生词本：脚本里的生词橙色高亮（已掌握的满级单词不再高亮），增删后事件刷新
  useEffect(() => {
    const load = (): void => {
      void api
        .vocabList()
        .then((list: VocabItem[]) => setVocabList(list))
        .catch(() => {})
    }
    load()
    window.addEventListener(VOCAB_CHANGED_EVENT, load)
    return () => window.removeEventListener(VOCAB_CHANGED_EVENT, load)
  }, [])

  // 高亮集合：未掌握的生词（小写）
  const vocabWords = useMemo(
    () =>
      new Set(
        vocabList
          .filter((v) => (v.reviewLevel ?? 0) < MASTERED_LEVEL)
          .map((v) => v.text.trim().toLowerCase())
      ),
    [vocabList]
  )

  if (!loaded) return <div className="page">加载中…</div>

  if (!script) {
    return (
      <PageShell
        title="跟读练习"
        desc='跟随提词器朗读练习；"原声"为 TTS 示范音'
        actions={
          <button className="icon-btn" title="返回收藏" onClick={() => navigate('/favorites')}>
            <BackIcon />
          </button>
        }
      >
        <div className="empty-hint">该视频还没有跟读脚本，请到收藏页点击卡片上的跟读按钮生成</div>
      </PageShell>
    )
  }

  const atEnd = position >= total

  const togglePlay = (): void => {
    if (atEnd) setPosition(0)
    setPlaying(!playing)
  }

  const stop = (): void => {
    setPlaying(false)
    setPosition(0)
  }

  return (
    <PageShell
      fill
      title={script.title || '跟读练习'}
      desc={
        `跟随提词器朗读练习；共 ${script.items.length} 句 · ` +
        (script.generatedBy === 'llm'
          ? '由 LLM 生成'
          : script.generatedBy === 'raw'
            ? '直接使用原始字幕'
            : script.llmError
              ? `LLM 调用失败（${script.llmError}），已回退本地规则生成`
              : '由本地规则生成（当前策略未使用 LLM）') +
        (script.generatedBy === 'raw' ? '；"原声"为视频对应片段' : '；"原声"为 TTS 示范音')
      }
      actions={
        <button className="icon-btn" title="返回收藏" onClick={() => navigate('/favorites')}>
          <BackIcon />
        </button>
      }
    >
      <div className="shadow-script">
        {script.items.map((it, i) => {
          const newScene = it.scene !== undefined && (i === 0 || it.scene !== script.items[i - 1].scene)
          return (
            <div key={i}>
              {newScene && <div className="shadow-scene">场景 {it.scene}</div>}
              <div
                className={i === currentIdx ? 'shadow-line active' : 'shadow-line'}
                onClick={() => setPosition(starts[i])}
              >
                <div className="shadow-en">
                  <WordSpans
                    text={it.text}
                    sentence={it.text}
                    knownWords={vocabWords}
                    onWord={(word, rect, sentence) => {
                      // 点词打开翻译弹窗；不触发行的跳转定位
                      setSelection({ text: word, rect, sentence })
                    }}
                  />
                </div>
                {showZh && it.zh && <div className="shadow-zh">{it.zh}</div>}
              </div>
            </div>
          )
        })}
      </div>
      <div className="shadow-player">
        <input
          className="shadow-progress"
          type="range"
          min={0}
          max={total}
          step={0.1}
          value={position}
          onChange={(e) => setPosition(Number(e.target.value))}
        />
        <div className="shadow-controls">
          <button onClick={togglePlay}>{playing ? '暂停' : '播放'}</button>
          <button onClick={stop}>停止</button>
          <button
            className={voiceOn ? 'selected' : ''}
            title={
              script.generatedBy === 'raw'
                ? '原声开关：开启后播放时每句自动放视频对应片段'
                : '原声开关：开启后播放时每句自动 TTS 朗读'
            }
            onClick={() => setVoiceOn(!voiceOn)}
          >
            原声
          </button>
          <label className="shadow-speed">
            速度
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.25}
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
            />
            {speed.toFixed(2).replace(/0+$/, '').replace(/\.$/, '.0')}x
          </label>
          <button onClick={() => setBgmOn(!bgmOn)}>音乐：{bgmOn ? '开' : '关'}</button>
          <button
            className={showZh ? 'selected' : ''}
            title="显示 / 隐藏脚本中文"
            onClick={() => setShowZh(!showZh)}
          >
            中文
          </button>
        </div>
      </div>
      <audio ref={bgmRef} src={bgmUrl} loop />
      {selection && (
        <TranslatePopup
          key={selection.text}
          text={selection.text}
          rect={selection.rect}
          sentence={selection.sentence}
          video={{ videoId: script.videoId, title: script.title }}
          time={script.items[Math.max(0, currentIdx)]?.start ?? 0}
          savedItem={
            vocabList.find(
              (v) => v.text.trim().toLowerCase() === selection.text.trim().toLowerCase()
            ) ?? null
          }
          onClose={() => setSelection(null)}
        />
      )}
    </PageShell>
  )
}
