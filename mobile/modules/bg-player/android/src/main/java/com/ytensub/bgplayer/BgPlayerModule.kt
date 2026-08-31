package com.ytensub.bgplayer

import android.os.Bundle
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * 后台播放保活 + 媒体控制模块：
 * start() 拉起前台服务（媒体卡片），update() 同步播放状态/标题，stop() 释放。
 * 通知上的播放/暂停键经 onMediaAction 事件转发给 JS 侧驱动 WebView。
 */
class BgPlayerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BgPlayer")

    Events("onMediaAction")

    OnCreate {
      Log.d("BgPlayer", "module created, listener attached")
      BgPlayerService.listener = { action ->
        Log.d("BgPlayer", "sendEvent onMediaAction: $action")
        this@BgPlayerModule.sendEvent("onMediaAction", Bundle().apply { putString("action", action) })
      }
    }

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

    Function("update") { playing: Boolean, title: String ->
      BgPlayerService.instance?.updateState(playing, title) != null
    }

    // JS 侧诊断日志透传到 logcat（release 包无 Metro，排查后台链路用）
    Function("log") { msg: String ->
      Log.d("BgPlayer", "JS: $msg")
      true
    }
  }
}
