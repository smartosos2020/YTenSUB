package com.ytensub.bgplayer

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * 后台播放保活模块：start() 拉起前台服务 + 部分唤醒锁，stop() 释放。
 * JS 侧在视频播放/暂停时调用。
 */
class BgPlayerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BgPlayer")

    Function("start") {
      val ctx = appContext.reactContext ?: return@Function false
      BgPlayerService.start(ctx)
      true
    }

    Function("stop") {
      val ctx = appContext.reactContext ?: return@Function false
      BgPlayerService.stop(ctx)
      true
    }
  }
}
