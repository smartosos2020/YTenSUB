/**
 * 注入 YouTube 页面的脚本（WebView 主世界）。
 *
 * 与桌面端同源思路：字幕轨地址走 innertube ANDROID 客户端接口（credentials:'omit'，
 * 不带 cookie 领到的地址未绑定会话，App 侧直接 fetch 才可用）。字幕正文不在页面里抓，
 * 只回传 baseUrl，由 RN 侧全局 fetch（无浏览器指纹、无 cookie）抓取正文。
 */

/** 常驻探针：250ms 上报播放进度与当前 videoId（SPA 导航不刷新页面，靠轮询发现换视频）。
 *  另带诊断：包装 pause() 抓调用方堆栈；play() 结果经 postMessage 回传 */
export const PROBE_SCRIPT = `
(function() {
  if (window.__ytensubProbe) return
  window.__ytensubProbe = true
  try {
    var origPause = HTMLMediaElement.prototype.pause
    HTMLMediaElement.prototype.pause = function() {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        kind: 'dbg', msg: 'pause-called', stack: (new Error().stack || '').slice(0, 400)
      }))
      return origPause.apply(this, arguments)
    }
  } catch (e) {}
  var lastId = null
  setInterval(function() {
    var m = location.pathname === '/watch'
      ? new URLSearchParams(location.search).get('v')
      : (location.pathname.match(/\\/shorts\\/([\\w-]+)/) || [])[1]
    var v = document.querySelector('video')
    window.ReactNativeWebView.postMessage(JSON.stringify({
      kind: 'tick',
      videoId: m || null,
      url: location.href,
      time: v ? v.currentTime : 0,
      paused: v ? v.paused : true
    }))
    lastId = m
  }, 250)
})()
`

/** 带结果回传的 play()：autoplay 策略拦截会 reject，原因 postMessage 回来；
 *  另挂 pause 事件监听（任何路径的暂停都会触发，包括内部路径），并回报元素状态 */
export const PLAY_DIAG_SCRIPT = `(function(){
  var v = document.querySelector('video')
  if (!v) { window.ReactNativeWebView.postMessage(JSON.stringify({ kind: 'dbg', msg: 'no-video' })); return }
  if (!v.__dbgPause) {
    v.__dbgPause = true
    v.addEventListener('pause', function() {
      window.ReactNativeWebView.postMessage(JSON.stringify({ kind: 'dbg', msg: 'pause-event t=' + v.currentTime.toFixed(2) }))
    })
  }
  v.play().then(function() {
    setTimeout(function() {
      window.ReactNativeWebView.postMessage(JSON.stringify({ kind: 'dbg', msg: 'play-ok; 300ms后: paused=' + v.paused + ' t=' + v.currentTime.toFixed(2) + ' readyState=' + v.readyState + ' videos=' + document.querySelectorAll('video').length }))
    }, 300)
  }).catch(function(e) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ kind: 'dbg', msg: 'play-fail: ' + e.name + ' | ' + e.message }))
  })
})()`

/** 提取视频信息与字幕轨地址（结果经 postMessage 回传，包一层 Promise 接线） */
const EXTRACT_BODY = `
  var videoId = new URLSearchParams(location.search).get('v')
    || ((location.pathname.match(/\\/shorts\\/([\\w-]+)/) || [])[1])
  if (!videoId) return { ok: false, reason: 'no-video-id' }
  var vd = null
  var tracks = []
  var apiError = null
  try {
    var res = await fetch('https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify({
        context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 34, hl: 'en' } },
        videoId: videoId
      })
    })
    var pr = await res.json()
    vd = pr.videoDetails || null
    tracks = ((pr.captions || {}).playerCaptionsTracklistRenderer || {}).captionTracks || []
  } catch (e) {
    apiError = String(e)
  }
  if (!vd) return { ok: false, reason: apiError || 'no-video-details' }
  var ens = tracks.filter(function(t) { return (t.languageCode || '').toLowerCase().indexOf('en') === 0 })
  var en = ens.find(function(t) { return t.kind !== 'asr' }) || ens[0] || null
  var zhs = tracks.filter(function(t) { return (t.languageCode || '').toLowerCase().replace(/_/g, '-').indexOf('zh') === 0 })
  var zhScore = function(t) { return (t.kind === 'asr' ? 0 : 10) + (/hans|cn|sg/i.test(t.languageCode || '') ? 2 : 0) }
  var zh = zhs.slice().sort(function(a, b) { return zhScore(b) - zhScore(a) })[0] || null
  return {
    ok: true,
    videoId: vd.videoId || videoId,
    title: vd.title || '',
    channel: vd.author || '',
    hasCaptions: !!en,
    enBaseUrl: (en && en.baseUrl) || null,
    zhBaseUrl: (zh && zh.baseUrl) || null
  }
`

/** 包装成可注入形态：执行 EXTRACT_BODY 并 postMessage 回传 { kind:'extract', payload } */
export const EXTRACT_SCRIPT = `(async function() {
  try {
    var payload = await (async function() { ${EXTRACT_BODY} })()
    window.ReactNativeWebView.postMessage(JSON.stringify({ kind: 'extract', payload: payload }))
  } catch (e) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ kind: 'extract', payload: { ok: false, reason: String(e) } }))
  }
})()
`

/** 暂停 / 恢复播放（点词翻译时暂停，关闭弹窗恢复；带回执便于排查后台注入是否执行） */
export const PAUSE_SCRIPT = `(function(){ var v = document.querySelector('video'); if (v) v.pause(); window.ReactNativeWebView.postMessage(JSON.stringify({ kind: 'dbg', msg: 'ack pause' })) })()`
export const PLAY_SCRIPT = `(function(){ var v = document.querySelector('video'); if (v) v.play(); window.ReactNativeWebView.postMessage(JSON.stringify({ kind: 'dbg', msg: 'ack play' })) })()`

/** 可见性伪装：App 进后台后 YouTube 仍认为页面可见（息屏播放的关键之一） */
export const VISIBILITY_SPOOF = `
(function() {
  try {
    Object.defineProperty(document, 'visibilityState', { get: function() { return 'visible' } })
    Object.defineProperty(document, 'hidden', { get: function() { return false } })
    document.addEventListener('visibilitychange', function(e) { e.stopImmediatePropagation() }, true)
  } catch (e) {}
})()
true
`

/** 跳转到指定时间并播放（点字幕行 seek） */
export function seekScript(t: number): string {
  return `(function(){ var v = document.querySelector('video'); if (v) { v.currentTime = ${JSON.stringify(t)}; v.play() } })()`
}
