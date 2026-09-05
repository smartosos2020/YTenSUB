/**
 * 在 YouTube 页面主世界执行的提取脚本（通过 webview.executeJavaScript）。
 *
 * 视频信息和字幕轨地址统一走 innertube ANDROID 客户端接口：
 * 页面 ytInitialPlayerResponse 里的 timedtext baseUrl 需要 PO token，
 * 直接 fetch 会返回空响应，因此不再使用页面内的字幕轨地址。
 * 页面 player response 仅作为视频信息的兜底。
 *
 * 字幕正文不在这里抓（2026-08 实测）：guest 浏览器上下文不带 cookie 请求 timedtext
 * 会被 YouTube 拖进慢车道（35s+），主进程 net.fetch 无浏览器指纹只需亚秒。
 * 所以这里只返回 baseUrl，正文由渲染进程经 IPC 交给主进程抓取。
 *
 * 注意：innertube 请求必须 credentials:'omit'——带登录 cookie 领到的 baseUrl
 * 与会话绑定，主进程（无 cookie）再抓会 502。
 */
export const EXTRACT_SCRIPT = `(async () => {
  const videoId = new URLSearchParams(location.search).get('v')
    || ((location.pathname.match(/\\/shorts\\/([\\w-]+)/) || [])[1])
  if (!videoId) return { ok: false, reason: 'no-video-id' }
  let vd = null
  let tracks = []
  let apiError = null
  let ytCategory = ''
  try {
    const res = await fetch('https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify({
        context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 34, hl: 'en' } },
        videoId
      })
    })
    const pr = await res.json()
    vd = pr.videoDetails || null
    tracks = ((pr.captions || {}).playerCaptionsTracklistRenderer || {}).captionTracks || []
    // YouTube 官方内容分类（自动打标签的免费基线）
    ytCategory = ((pr.microformat || {}).playerMicroformatRenderer || {}).category || ''
  } catch (e) {
    apiError = String(e)
  }
  if (!vd) {
    const pr2 = window.ytInitialPlayerResponse
    if (pr2 && pr2.videoDetails) vd = pr2.videoDetails
    if (pr2 && pr2.microformat && !ytCategory) {
      ytCategory = (pr2.microformat.playerMicroformatRenderer || {}).category || ''
    }
  }
  if (!vd) return { ok: false, reason: apiError || 'no-video-details', title: document.title }
  // 频道头像：player response 里没有，从页面 DOM 抓（所有者栏的头像 img）
  var avatarEl = document.querySelector('ytd-video-owner-renderer #avatar img')
    || document.querySelector('#owner img#img')
    || document.querySelector('#avatar img')
  var channelAvatar = avatarEl && avatarEl.src ? avatarEl.src : ''
  // 优先人工英文字幕，其次自动生成的英文字幕（kind === 'asr'）
  const ens = tracks.filter(t => (t.languageCode || '').toLowerCase().startsWith('en'))
  const en = ens.find(t => t.kind !== 'asr') || ens[0] || null
  // 中文字幕轨：人工优于自动生成，简体（Hans/CN/SG）优先
  const zhs = tracks.filter(t => (t.languageCode || '').toLowerCase().replace(/_/g, '-').startsWith('zh'))
  const zhScore = t => (t.kind === 'asr' ? 0 : 10) + (/hans|cn|sg/i.test(t.languageCode || '') ? 2 : 0)
  const zh = zhs.slice().sort((a, b) => zhScore(b) - zhScore(a))[0] || null
  return {
    ok: true,
    videoId: vd.videoId || videoId,
    title: vd.title || '',
    channel: vd.author || '',
    duration: Number(vd.lengthSeconds) || 0,
    channelAvatar: channelAvatar,
    ytCategory: ytCategory,
    hasCaptions: !!en,
    enBaseUrl: (en && en.baseUrl) || null,
    zhBaseUrl: (zh && zh.baseUrl) || null
  }
})()`
