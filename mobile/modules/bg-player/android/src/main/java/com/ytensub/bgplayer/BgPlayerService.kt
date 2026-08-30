package com.ytensub.bgplayer

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

/**
 * 前台服务：状态栏常驻低优先级通知（防 ColorOS 杀后台）+ PARTIAL_WAKE_LOCK（息屏 CPU 不休眠）。
 * 两个条件凑齐后，WebView 里的 YouTube 在息屏/切后台时可继续出声。
 */
class BgPlayerService : Service() {

  companion object {
    private const val CHANNEL_ID = "ytensub-bg"
    private const val NOTIF_ID = 42

    fun start(ctx: Context) {
      val intent = Intent(ctx, BgPlayerService::class.java)
      ctx.startForegroundService(intent)
    }

    fun stop(ctx: Context) {
      ctx.stopService(Intent(ctx, BgPlayerService::class.java))
    }
  }

  private var wakeLock: PowerManager.WakeLock? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val nm = getSystemService(NotificationManager::class.java)
      nm.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "后台播放", NotificationManager.IMPORTANCE_LOW)
      )
    }
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
      Notification.Builder(this, CHANNEL_ID)
    else
      Notification.Builder(this)
    val notification = builder
      .setContentTitle("YTenSUB 后台播放中")
      .setSmallIcon(android.R.drawable.ic_media_play)
      .setOngoing(true)
      .build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
    } else {
      startForeground(NOTIF_ID, notification)
    }

    if (wakeLock?.isHeld != true) {
      val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
      wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ytensub:bg").apply { acquire() }
    }
    return START_STICKY
  }

  override fun onDestroy() {
    if (wakeLock?.isHeld == true) wakeLock?.release()
    wakeLock = null
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null
}
