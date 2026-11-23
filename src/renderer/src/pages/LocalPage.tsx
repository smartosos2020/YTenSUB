import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, TextInput } from '@mantine/core'
import { formatSubtitleGloss } from '../../../shared/subtitle-gloss'
import {
  Cue,
  findActiveCueIndex,
  parseExternalSubtitle,
  toBilingualSrt
} from '../../../shared/captions'
import type { LocalVideoFile, OnlineSubtitleCandidate } from '../../../shared/local-media'
import type { CaptionTexture, VocabItem } from '../../../shared/types'
import { api, SETTINGS_CHANGED_EVENT, VOCAB_CHANGED_EVENT } from '../api'
import { captionFontCss } from '../caption-fonts'
import { findSavedByLemma, lemmatize, toKnownLemmas } from '../lemma'
import CaptionOverlay from '../components/CaptionOverlay'
import SubtitlePanel, { WordSelection } from '../components/SubtitlePanel'
import TranslatePopup from '../components/TranslatePopup'
import LocalPlaylist from '../components/LocalPlaylist'
import SidebarToggleIcon from '../components/SidebarToggleIcon'
import { useSidePanel } from '../hooks/useSidePanel'
import { useZhSubtitles } from '../hooks/useZhSubtitles'
import { useLocalAudioFallback } from '../hooks/useLocalAudioFallback'

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error invoking remote method '[^']+': Error: /, '')
}

function fileSize(bytes: number): string {
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

/** 桌面端本地视频播放器，选中的在线字幕自动保存到视频目录的 dSub 文件夹。 */
export default function LocalPage(): JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const videoWrapRef = useRef<HTMLDivElement | null>(null)
  const resumeOnCloseRef = useRef(false)
  const hoverPausedRef = useRef(false)
  const lastLoopCueRef = useRef(-1)
  const pendingSeekRef = useRef<number | null>(null)
  const currentMediaRef = useRef<LocalVideoFile | null>(null)
  const videoOpenRequestRef = useRef(0)
  const [openingVideoPath, setOpeningVideoPath] = useState<string | null>(null)
  const { sideTab, setSideTab, sideCollapsed, toggleSide, sideWidth, startSideResize } =
    useSidePanel('ytensub:local-side')
  const [media, setMedia] = useState<LocalVideoFile | null>(null)
  const [query, setQuery] = useState('')
  const [cues, setCues] = useState<Cue[]>([])
  const [subtitleName, setSubtitleName] = useState('')
  const [subtitleOffset, setSubtitleOffset] = useState(0)
  const [time, setTime] = useState(0)
  const [searching, setSearching] = useState(false)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<OnlineSubtitleCandidate[]>([])
  const [resultsExpanded, setResultsExpanded] = useState(false)
  const [status, setStatus] = useState('选择一集本地视频开始学习')
  const [selection, setSelection] = useState<WordSelection | null>(null)
  const [looping, setLooping] = useState(false)
  const [vocabList, setVocabList] = useState<VocabItem[]>([])
  const [captionOpacity, setCaptionOpacity] = useState(0.72)
  const [showCaptions, setShowCaptions] = useState(true)
  const [captionFontSize, setCaptionFontSize] = useState(20)
  const [captionZhSize, setCaptionZhSize] = useState(16)
  const [captionFont, setCaptionFont] = useState('default')
  const [captionWeight, setCaptionWeight] = useState(400)
  const [captionShadow, setCaptionShadow] = useState(true)
  const [captionTexture, setCaptionTexture] = useState<CaptionTexture>('solid')
  const [localVolume, setLocalVolume] = useState(1)
  const [localMuted, setLocalMuted] = useState(false)
  const [playbackRequested, setPlaybackRequested] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const audioState = useLocalAudioFallback(videoRef, media?.url ?? null, playbackRequested)

  const shiftedCues = useMemo(
    () => cues.map((cue) => ({ ...cue, start: Math.max(0, cue.start + subtitleOffset) })),
    [cues, subtitleOffset]
  )
  const knownWords = useMemo(() => toKnownLemmas(vocabList), [vocabList])
  const savedTranslations = useMemo(
    () => new Map(vocabList.map((item) => [lemmatize(item.text), formatSubtitleGloss(item.translation)])),
    [vocabList]
  )
  const {
    showZh,
    setShowZh,
    zhLines,
    zhLoading,
    toggleZh,
    resetZh,
    hasZhNative,
    zhOffset,
    adjustZhOffset
  } = useZhSubtitles(shiftedCues)

  useEffect(() => {
    const videoRequests = videoOpenRequestRef
    const loadSettings = (): void => {
      void api.settingsGet().then((settings) => {
        setCaptionOpacity(settings.captionOpacity ?? 0.72)
        setShowCaptions(settings.showCaptions ?? true)
        setShowZh(settings.showZhSubtitle ?? false)
        setCaptionFontSize(settings.captionFontSize ?? 20)
        setCaptionZhSize(settings.captionZhSize ?? 16)
        setCaptionFont(settings.captionFont ?? 'default')
        setCaptionWeight(settings.captionWeight ?? 400)
        setCaptionShadow(settings.captionShadow ?? true)
        setCaptionTexture(settings.captionTexture ?? 'solid')
      })
    }
    const loadVocab = (): void => {
      void api.vocabList().then(setVocabList).catch(() => {})
    }
    loadSettings()
    loadVocab()
    window.addEventListener(SETTINGS_CHANGED_EVENT, loadSettings)
    window.addEventListener(VOCAB_CHANGED_EVENT, loadVocab)
    return () => {
      currentMediaRef.current = null
      videoRequests.current++
      window.removeEventListener(SETTINGS_CHANGED_EVENT, loadSettings)
      window.removeEventListener(VOCAB_CHANGED_EVENT, loadVocab)
    }
  }, [setShowZh])

  const applySubtitle = useCallback((fileName: string, text: string): boolean => {
    const parsed = parseExternalSubtitle(text)
    if (!parsed.length) {
      setStatus(`无法解析字幕：${fileName}`)
      return false
    }
    setCues(parsed)
    lastLoopCueRef.current = -1
    setSubtitleName(fileName)
    setSubtitleOffset(0)
    resetZh()
    setStatus(`已加载 ${parsed.length} 句英文字幕`)
    return true
  }, [resetZh])

  const downloadCandidate = useCallback(async (
    candidate: OnlineSubtitleCandidate,
    target: LocalVideoFile | null = media
  ): Promise<void> => {
    if (!target) return
    setDownloadingId(candidate.id)
    try {
      const subtitle = await api.localDownloadSubtitle(candidate.fileId, target.path)
      if (currentMediaRef.current !== target) return
      if (!applySubtitle(subtitle.fileName, subtitle.text)) return
      setResultsExpanded(false)
      const saved = subtitle.savedPath
        ? '字幕已加载，已自动保存到 dSub 文件夹'
        : `字幕已加载，自动保存失败：${subtitle.saveError ?? '未知错误'}`
      setStatus(saved + (subtitle.remaining !== undefined
        ? `；本日匿名下载剩余 ${subtitle.remaining} 次`
        : ''))
    } catch (error) {
      if (currentMediaRef.current === target) setStatus(errorMessage(error))
    } finally {
      if (currentMediaRef.current === target) setDownloadingId(null)
    }
  }, [applySubtitle, media])

  const searchOnline = useCallback(async (
    target: LocalVideoFile | null = media,
    targetQuery: string = query
  ): Promise<void> => {
    if (!target || searching) return
    setSearching(true)
    setCandidates([])
    setStatus('正在按文件 Hash 与剧集信息搜索英文字幕…')
    try {
      const results = await api.localSearchSubtitles({ ...target, query: targetQuery.trim() || target.query })
      if (currentMediaRef.current !== target) return
      setCandidates(results)
      setResultsExpanded(results.length > 0)
      if (!results.length) {
        setStatus('没有找到匹配字幕，可修改剧名后重试或选择本地字幕')
        return
      }
      const exact = results.find((item) => item.exactMatch)
      setStatus(exact ? '找到文件 Hash 精确匹配，正在加载…' : `找到 ${results.length} 个候选，请选择版本`)
      if (exact && cues.length === 0) await downloadCandidate(exact, target)
    } catch (error) {
      if (currentMediaRef.current === target) setStatus(errorMessage(error))
    } finally {
      if (currentMediaRef.current === target) setSearching(false)
    }
  }, [cues.length, downloadCandidate, media, query, searching])

  const loadVideo = async (picked: LocalVideoFile, autoplay: boolean): Promise<void> => {
    if (currentMediaRef.current?.path === picked.path && videoRef.current?.readyState) {
      videoRef.current.currentTime = 0
      if (autoplay) void videoRef.current.play()
    }
    currentMediaRef.current = picked
    setMedia(picked)
    setSearching(false)
    setDownloadingId(null)
    setPlaybackRequested(autoplay)
    lastLoopCueRef.current = -1
    pendingSeekRef.current = null
    hoverPausedRef.current = false
    resumeOnCloseRef.current = false
    setSelection(null)
    setQuery(picked.query)
    setCues([])
    setCandidates([])
    setResultsExpanded(false)
    setSubtitleName('')
    setSubtitleOffset(0)
    setTime(0)
    resetZh()
    if (picked.sidecarSubtitle) {
      applySubtitle(picked.sidecarSubtitle.fileName, picked.sidecarSubtitle.text)
      return
    }
    const settings = await api.settingsGet()
    if (currentMediaRef.current !== picked) return
    setStatus(settings.openSubtitlesApiKey
      ? '未发现同名字幕；点击“在线找英文字幕”可手动搜索'
      : '未发现同名字幕；可选择本地字幕，或在设置中填写 OpenSubtitles API Key')
  }

  const openVideo = async (): Promise<void> => {
    const request = ++videoOpenRequestRef.current
    setOpeningVideoPath(null)
    try {
      const picked = await api.localPickVideo()
      if (picked && videoOpenRequestRef.current === request) await loadVideo(picked, false)
    } catch (error) {
      if (videoOpenRequestRef.current === request) setStatus(errorMessage(error))
    }
  }

  const openPlaylistVideo = async (filePath: string): Promise<void> => {
    const request = ++videoOpenRequestRef.current
    setOpeningVideoPath(filePath)
    setStatus('正在打开视频…')
    try {
      const picked = await api.localPlaylistOpenVideo(filePath)
      if (videoOpenRequestRef.current === request) await loadVideo(picked, true)
    } catch (error) {
      if (videoOpenRequestRef.current === request) setStatus(`打开视频失败：${errorMessage(error)}`)
    } finally {
      if (videoOpenRequestRef.current === request) setOpeningVideoPath(null)
    }
  }

  const openSubtitle = async (): Promise<void> => {
    const picked = await api.localPickSubtitle()
    if (picked) applySubtitle(picked.fileName, picked.text)
  }

  const seek = useCallback((nextTime: number): void => {
    const target = Math.max(0, nextTime)
    const video = videoRef.current
    if (!video || video.readyState === 0) {
      pendingSeekRef.current = target
      setPlaybackRequested(true)
      return
    }
    video.currentTime = target
    setTime(video.currentTime)
  }, [])

  const openSelection = useCallback((next: WordSelection): void => {
    const video = videoRef.current
    resumeOnCloseRef.current = video ? !video.paused || hoverPausedRef.current : false
    hoverPausedRef.current = false
    video?.pause()
    setSelection(next)
  }, [])

  const closeSelection = useCallback((): void => {
    setSelection(null)
    if (resumeOnCloseRef.current) void videoRef.current?.play()
    resumeOnCloseRef.current = false
  }, [])

  useEffect(() => {
    const player = videoWrapRef.current
    const onFullscreenChange = (): void => {
      setIsFullscreen(document.fullscreenElement === player)
      closeSelection()
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      if (document.fullscreenElement === player) void document.exitFullscreen().catch(() => {})
    }
  }, [closeSelection])

  const toggleFullscreen = async (): Promise<void> => {
    const player = videoWrapRef.current
    if (!player) return
    try {
      if (document.fullscreenElement === player) await document.exitFullscreen()
      else await player.requestFullscreen()
    } catch (error) {
      setStatus(`全屏切换失败：${errorMessage(error)}`)
    }
  }

  const onCaptionEnter = (): void => {
    const video = videoRef.current
    if (!video || video.paused || selection) return
    hoverPausedRef.current = true
    video.pause()
  }

  const onCaptionLeave = (): void => {
    if (!hoverPausedRef.current || selection) return
    hoverPausedRef.current = false
    void videoRef.current?.play()
  }

  const updateTime = (): void => {
    const video = videoRef.current
    if (!video) return
    const current = video.currentTime
    setTime(current)
    const active = findActiveCueIndex(shiftedCues, current)
    if (active >= 0) lastLoopCueRef.current = active
    if (!looping || lastLoopCueRef.current < 0) return
    const cue = shiftedCues[lastLoopCueRef.current]
    if (cue && current >= cue.start + cue.dur - 0.08 && current <= cue.start + cue.dur + 0.5) {
      video.currentTime = cue.start
    }
  }

  const adjustEnglishOffset = (delta: number): void => {
    setSubtitleOffset((value) => Math.min(10, Math.max(-10, Math.round((value + delta) * 10) / 10)))
  }

  const updateLocalVolume = (value: number): void => {
    const volume = Math.min(1, Math.max(0, value))
    setLocalVolume(volume)
    if (volume > 0 && localMuted) setLocalMuted(false)
    if (videoRef.current) {
      videoRef.current.volume = volume
      if (volume > 0) videoRef.current.muted = false
    }
  }

  const toggleLocalMute = (): void => {
    const muted = !localMuted
    setLocalMuted(muted)
    if (videoRef.current) videoRef.current.muted = muted
  }

  const exportSubtitles = (): void => {
    if (!cues.length) return
    void api.saveTextFile({
      defaultName: `${media?.name ?? 'subtitles'}.srt`,
      content: toBilingualSrt(shiftedCues, showZh ? zhLines : null),
      filterName: 'SRT 字幕',
      ext: 'srt'
    })
  }

  return (
    <div className="local-page">
      <div className="local-toolbar">
        <Button size="xs" onClick={() => void openVideo()}>打开视频</Button>
        <Button size="xs" variant="default" disabled={!media} onClick={() => void openSubtitle()}>
          选择本地字幕
        </Button>
        {media && (
          <>
            <TextInput
              size="xs"
              className="local-query"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void searchOnline() }}
              placeholder="剧名"
            />
            <Button size="xs" variant="default" loading={searching} onClick={() => void searchOnline()}>
              在线找英文字幕
            </Button>
            {candidates.length > 0 && (
              <Button
                size="xs"
                variant="subtle"
                aria-expanded={resultsExpanded}
                aria-controls="local-subtitle-results"
                onClick={() => setResultsExpanded((expanded) => !expanded)}
              >
                {resultsExpanded ? '收起字幕列表' : `展开字幕列表（${candidates.length}）`}
              </Button>
            )}
          </>
        )}
        <span className="local-status" title={status}>{status}</span>
        <button
          type="button"
          className="local-side-toggle"
          title={sideCollapsed ? '展开右栏' : '收起右栏'}
          aria-label={sideCollapsed ? '展开右栏' : '收起右栏'}
          aria-expanded={!sideCollapsed}
          aria-controls="local-side-panel"
          onClick={toggleSide}
        >
          <SidebarToggleIcon mirrored />
        </button>
      </div>

      <div className="local-body">
        <div className="local-main">
          <div className="local-video-wrap" ref={videoWrapRef}>
            {media && playbackRequested ? (
              <video
                ref={videoRef}
                className="local-video"
                src={media.url}
                controls
                controlsList="nofullscreen"
                autoPlay
                preload="metadata"
                onLoadedMetadata={(event) => {
                  const video = event.currentTarget
                  video.volume = localVolume
                  video.muted = localMuted
                  if (pendingSeekRef.current !== null) {
                    video.currentTime = pendingSeekRef.current
                    pendingSeekRef.current = null
                  }
                }}
                onTimeUpdate={updateTime}
                onSeeked={updateTime}
                onDoubleClick={(event) => {
                  event.preventDefault()
                  void toggleFullscreen()
                }}
                onError={() => setStatus('当前格式/编码无法直接播放；首版建议使用 MP4（H.264/AAC）或 WebM')}
              />
            ) : media ? (
              <button className="local-empty" onClick={() => setPlaybackRequested(true)}>
                <span>▶</span>
                <b>开始播放</b>
              </button>
            ) : (
              <button className="local-empty" onClick={() => void openVideo()}>
                <span>▶</span>
                <b>打开本地美剧</b>
                <small>不会复制或上传视频，只读取头尾各 64 KB 用于字幕匹配</small>
              </button>
            )}
            {media && (
              <CaptionOverlay
                cues={shiftedCues}
                time={time}
                hidden={!showCaptions}
                opacity={captionOpacity}
                fontSize={captionFontSize}
                zhSize={captionZhSize}
                fontFamily={captionFontCss(captionFont)}
                weight={captionWeight}
                shadow={captionShadow}
                texture={captionTexture}
                showZh={showZh}
                zhLines={zhLines}
                knownWords={knownWords}
                savedTranslations={savedTranslations}
                onWordSelect={openSelection}
                onCaptionEnter={onCaptionEnter}
                onCaptionLeave={onCaptionLeave}
              />
            )}
            {media && playbackRequested && (
              <button
                type="button"
                className="local-fullscreen-button"
                aria-label={isFullscreen ? '退出全屏' : '全屏'}
                title={isFullscreen ? '退出全屏（Esc）' : '全屏（也可双击画面）'}
                onClick={() => void toggleFullscreen()}
              >
                {isFullscreen ? '退出全屏' : '全屏'}
              </button>
            )}
            {selection && media && (
              <TranslatePopup
                key={`${selection.text}:${selection.rect.left}`}
                text={selection.text}
                rect={selection.rect}
                sentence={selection.sentence}
                video={{ videoId: `local:${media.hash ?? media.name}`, title: media.name }}
                time={time}
                savedItem={findSavedByLemma(vocabList, selection.text)}
                onClose={closeSelection}
              />
            )}
          </div>

          {media && (
            <div className="local-file-info">
              <span title={media.path}>{media.name}</span>
              <span>{fileSize(media.size)}</span>
              <span>{media.hash ? `Hash ${media.hash}` : '文件过小，无法计算 Hash'}</span>
              {audioState.kind !== 'idle' && (
                <span
                  className={`local-audio-state ${audioState.kind}`}
                  title={audioState.kind === 'error' ? audioState.detail : audioState.label}
                >
                  🔊 {audioState.label}
                </span>
              )}
              {audioState.kind === 'fallback' && (
                <span className="local-volume-control">
                  <button
                    type="button"
                    title={localMuted ? '取消静音' : '静音'}
                    aria-label={localMuted ? '取消静音' : '静音'}
                    onClick={toggleLocalMute}
                  >
                    {localMuted || localVolume === 0 ? '🔇' : localVolume < 0.5 ? '🔉' : '🔊'}
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={Math.round(localVolume * 100)}
                    aria-label="兼容音频音量"
                    title={`音量 ${Math.round(localVolume * 100)}%`}
                    onChange={(event) => updateLocalVolume(Number(event.currentTarget.value) / 100)}
                  />
                  <b>{localMuted ? 0 : Math.round(localVolume * 100)}%</b>
                </span>
              )}
              {subtitleName && <span>字幕：{subtitleName}</span>}
              {cues.length > 0 && (
                <span className="local-offset">
                  英文偏移
                  <button onClick={() => adjustEnglishOffset(-0.5)}>−0.5s</button>
                  <b>{subtitleOffset > 0 ? '+' : ''}{subtitleOffset.toFixed(1)}s</b>
                  <button onClick={() => adjustEnglishOffset(0.5)}>+0.5s</button>
                </span>
              )}
            </div>
          )}

          {candidates.length > 0 && resultsExpanded && (
            <div className="local-results" id="local-subtitle-results" aria-label="在线英文字幕候选">
              {candidates.map((candidate, index) => (
                <button
                  key={candidate.id}
                  className={index === 0 ? 'local-result recommended' : 'local-result'}
                  disabled={downloadingId !== null}
                  onClick={() => void downloadCandidate(candidate)}
                >
                  <span>
                    <b title={candidate.fileName}>
                      {index === 0 && <strong className="local-recommended">推荐</strong>}
                      {candidate.exactMatch ? '精确匹配 · ' : ''}{candidate.fileName}
                    </b>
                    <small title={candidate.release}>
                      {candidate.release || 'OpenSubtitles'}{candidate.hearingImpaired ? ' · 听障字幕' : ''}
                    </small>
                    <small className="local-match-reasons" title={candidate.matchReasons.join(' · ')}>
                      {candidate.matchReasons.join(' · ')}
                    </small>
                  </span>
                  <em>{downloadingId === candidate.id ? '加载中…' : `${candidate.downloads} 下载`}</em>
                </button>
              ))}
            </div>
          )}
        </div>

        <aside
          id="local-side-panel"
          className="side-panel local-side"
          style={{ width: sideCollapsed ? 0 : sideWidth, borderLeftWidth: sideCollapsed ? 0 : undefined }}
          aria-label="本地视频右栏"
        >
          {!sideCollapsed && <div className="side-resizer" title="拖拽调整宽度" onMouseDown={startSideResize} />}
          <div className="side-panel-inner" style={{ width: sideWidth }}>
            <div className="side-tabs" role="tablist" aria-label="本地视频右栏标签">
              <button
                id="local-subs-tab"
                role="tab"
                aria-selected={sideTab === 'subs'}
                aria-controls="local-subs-panel"
                className={sideTab === 'subs' ? 'selected' : ''}
                onClick={() => setSideTab('subs')}
              >字幕</button>
              <button
                id="local-playlist-tab"
                role="tab"
                aria-selected={sideTab === 'playlist'}
                aria-controls="local-playlist-panel"
                className={sideTab === 'playlist' ? 'selected' : ''}
                onClick={() => setSideTab('playlist')}
              >播放列表</button>
            </div>
            <div id="local-subs-panel" className="local-tab-panel" role="tabpanel" aria-labelledby="local-subs-tab" hidden={sideTab !== 'subs'}>
              <SubtitlePanel
                key={JSON.stringify([media?.url, subtitleName])}
                cues={shiftedCues}
                windowed
                time={time}
                hasCaptions={!!media}
                onSeek={seek}
                onWordSelect={openSelection}
                showZh={showZh}
                zhLines={zhLines}
                zhLoading={zhLoading}
                onShowZhChange={toggleZh}
                knownWords={knownWords}
                savedTranslations={savedTranslations}
                looping={looping}
                onLoopChange={setLooping}
                hasZhNative={hasZhNative}
                zhOffset={zhOffset}
                onZhOffset={adjustZhOffset}
                onExport={exportSubtitles}
              />
            </div>
            <div id="local-playlist-panel" className="local-tab-panel" role="tabpanel" aria-labelledby="local-playlist-tab" hidden={sideTab !== 'playlist'}>
              <LocalPlaylist currentPath={media?.path} openingPath={openingVideoPath} onPlay={(filePath) => void openPlaylistVideo(filePath)} />
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
