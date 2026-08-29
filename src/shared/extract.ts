/**
 * 在 YouTube 页面主世界执行的提取脚本（通过 webview.executeJavaScript）。
 *
 * 视频信息和字幕统一走 innertube ANDROID 客户端接口：
 * 页面 ytInitialPlayerResponse 里的 timedtext baseUrl 需要 PO token，
 * 直接 fetch 会返回空响应，因此不再使用页面内的字幕轨地址。
 * 页面 player response 仅作为视频信息的兜底。
 *
 * timedtext 抓取的两个坑（2026-08 实测）：
 * 1. 必须 credentials:'omit'——带着 YouTube 登录态 cookie 请求会被拒（返回 HTML 错误页）；
 * 2. baseUrl 已自带 fmt=srv3，再追加 fmt=json3 会出现两个 fmt 参数被拒。
 *    直接按原样抓即可，parseCaptionText 会自动判别 json3 / srv XML。
 */
export const EXTRACT_SCRIPT = `(async () => {
  const videoId = new URLSearchParams(location.search).get('v')
    || ((location.pathname.match(/\\/shorts\\/([\\w-]+)/) || [])[1])
  if (!videoId) return { ok: false, reason: 'no-video-id' }
  let vd = null
  let tracks = []
  let apiError = null
  try {
    const res = await fetch('https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 34, hl: 'en' } },
        videoId
      })
    })
    const pr = await res.json()
    vd = pr.videoDetails || null
    tracks = ((pr.captions || {}).playerCaptionsTracklistRenderer || {}).captionTracks || []
  } catch (e) {
    apiError = String(e)
  }
  if (!vd) {
    const pr2 = window.ytInitialPlayerResponse
    if (pr2 && pr2.videoDetails) vd = pr2.videoDetails
  }
  if (!vd) return { ok: false, reason: apiError || 'no-video-details', title: document.title }
  // 优先人工英文字幕，其次自动生成的英文字幕（kind === 'asr'）
  const ens = tracks.filter(t => (t.languageCode || '').toLowerCase().startsWith('en'))
  const en = ens.find(t => t.kind !== 'asr') || ens[0] || null
  // 中文字幕轨：人工优于自动生成，简体（Hans/CN/SG）优先
  const zhs = tracks.filter(t => (t.languageCode || '').toLowerCase().replace(/_/g, '-').startsWith('zh'))
  const zhScore = t => (t.kind === 'asr' ? 0 : 10) + (/hans|cn|sg/i.test(t.languageCode || '') ? 2 : 0)
  const zh = zhs.slice().sort((a, b) => zhScore(b) - zhScore(a))[0] || null
  let captionText = null
  let captionError = null
  let zhCaptionText = null
  let zhSource = null
  // timedtext 统一抓取：不带 cookie（credentials:'omit'），baseUrl 原样使用不追加 fmt
  const fetchTrack = async (baseUrl, tlang) => {
    let url = baseUrl
    if (tlang) {
      const u = new URL(baseUrl)
      u.searchParams.set('tlang', tlang)
      url = u.toString()
    }
    const r = await fetch(url, { credentials: 'omit' })
    const txt = await r.text()
    return txt || null
  }
  if (en && en.baseUrl) {
    try {
      captionText = await fetchTrack(en.baseUrl)
      if (!captionText) captionError = 'empty-body'
    } catch (e) {
      captionError = String(e)
    }
  }
  // 中文字幕失败不阻断英文字幕；没有自带中文轨时尝试 YouTube 机器翻译轨（tlang）
  try {
    if (zh && zh.baseUrl) {
      zhCaptionText = await fetchTrack(zh.baseUrl)
      if (zhCaptionText) zhSource = 'track'
    }
    if (!zhCaptionText && en && en.baseUrl) {
      zhCaptionText = await fetchTrack(en.baseUrl, 'zh-Hans')
      if (zhCaptionText) zhSource = 'tlang'
    }
  } catch (e) {
    zhCaptionText = null
    zhSource = null
  }
  return {
    ok: true,
    videoId: vd.videoId || videoId,
    title: vd.title || '',
    channel: vd.author || '',
    hasCaptions: !!en,
    captionError,
    captionText,
    zhCaptionText,
    zhSource
  }
})()`
