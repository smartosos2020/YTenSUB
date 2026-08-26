/**
 * 浏览页 webview 的原声播放桥：BrowsePage 常驻挂载并在挂载时注册控制器，
 * 跟读页通过它播放脚本句对应的视频原声片段。
 * 浏览页 UI 零改动，只是多注册了一个播放器。
 */
interface GuestAudioController {
  /** 播放指定视频 [start, start+dur) 片段；当前视频不符时先加载该视频 */
  playSegment: (videoId: string, start: number, dur: number) => void
  stop: () => void
}

let controller: GuestAudioController | null = null

export function registerGuestAudio(c: GuestAudioController): () => void {
  controller = c
  return () => {
    controller = null
  }
}

/** 返回 false 表示桥不可用（理论上 BrowsePage 常驻不会发生），调用方可兜底 TTS */
export function playGuestSegment(videoId: string, start: number, dur: number): boolean {
  if (!controller) return false
  controller.playSegment(videoId, start, dur)
  return true
}

export function stopGuestSegment(): void {
  controller?.stop()
}
