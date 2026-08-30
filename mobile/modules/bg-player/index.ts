import { requireNativeModule } from 'expo-modules-core'

interface BgPlayerModuleType {
  /** 拉起前台服务 + 唤醒锁（开始播放时调用） */
  start(): void
  /** 停止服务、释放唤醒锁（暂停/退出时调用） */
  stop(): void
}

export const BgPlayer = requireNativeModule<BgPlayerModuleType>('BgPlayer')
