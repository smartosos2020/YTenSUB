import { EventEmitter, requireNativeModule } from 'expo-modules-core'

interface BgPlayerModuleType {
  /** 拉起前台服务 + 媒体卡片（开始播放时调用） */
  start(): boolean
  /** 停止服务、释放唤醒锁（无视频/退出时调用） */
  stop(): boolean
  /** 同步播放状态与标题到媒体卡片；播放状态决定唤醒锁收放 */
  update(playing: boolean, title: string): boolean
  /** JS 诊断日志透传到 logcat（tag: BgPlayer） */
  log(msg: string): boolean
}

export const BgPlayer = requireNativeModule<BgPlayerModuleType>('BgPlayer')

const emitter = new EventEmitter<{ onMediaAction: (e: { action: 'play' | 'pause' }) => void }>(
  BgPlayer as never
)

/** 订阅通知/锁屏上的播放控制事件；返回退订函数 */
export function onMediaAction(cb: (action: 'play' | 'pause') => void): () => void {
  const sub = emitter.addListener('onMediaAction', (e) => cb(e.action))
  return () => sub.remove()
}
