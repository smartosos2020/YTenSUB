package com.ytensub.bgplayer

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log

/**
 * 前台服务 + MediaSession：状态栏/锁屏媒体卡片（播放/暂停，Spotify 式控制中心），
 * 常驻低优先级通知防 ColorOS 杀后台；播放时持 PARTIAL_WAKE_LOCK（息屏 CPU 不休眠），
 * 暂停时释放唤醒锁省电但服务保活（通知不消失，可从控制中心恢复播放）。
 */
class BgPlayerService : Service() {

  companion object {
    private const val CHANNEL_ID = "ytensub-bg"
    private const val NOTIF_ID = 42
    private const val ACTION_PLAY = "ytensub.bg.PLAY"
    private const val ACTION_PAUSE = "ytensub.bg.PAUSE"

    /** 播放/暂停动作回调（由 BgPlayerModule 挂接，转发给 JS） */
    var listener: ((String) -> Unit)? = null
    /** 当前服务实例（模块侧更新状态用） */
    var instance: BgPlayerService? = null

    fun start(ctx: Context) {
      val intent = Intent(ctx, BgPlayerService::class.java)
      ctx.startForegroundService(intent)
    }

    fun stop(ctx: Context) {
      ctx.stopService(Intent(ctx, BgPlayerService::class.java))
    }
  }

  private var wakeLock: PowerManager.WakeLock? = null
  private var mediaSession: MediaSession? = null
  private var playing = false
  private var title = ""

  override fun onCreate() {
    super.onCreate()
    instance = this
    mediaSession = MediaSession(this, "ytensub").apply {
      setCallback(object : MediaSession.Callback() {
        // 系统媒体控制（通知栏/锁屏）走 MediaSession 回调，不经通知按钮的 PendingIntent
        override fun onPlay() {
          resumePlayback()
          listener?.invoke("play")
        }
        override fun onPause() {
          pausePlayback()
          listener?.invoke("pause")
        }
      })
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    Log.d("BgPlayer", "onStartCommand action=${intent?.action} listener=${listener != null}")
    when (intent?.action) {
      // 媒体卡片按钮：走音频焦点通道控制 WebView（后台时页面主线程冻结，JS 注入无效）
      ACTION_PLAY -> { resumePlayback(); listener?.invoke("play"); return START_STICKY }
      ACTION_PAUSE -> { pausePlayback(); listener?.invoke("pause"); return START_STICKY }
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val nm = getSystemService(NotificationManager::class.java)
      nm.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "后台播放", NotificationManager.IMPORTANCE_LOW)
      )
    }
    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
    } else {
      startForeground(NOTIF_ID, notification)
    }
    return START_STICKY
  }

  /** 模块侧调用：更新播放状态与标题，刷新媒体卡片；唤醒锁随播放状态收放 */
  fun updateState(nowPlaying: Boolean, nowTitle: String) {
    playing = nowPlaying
    title = nowTitle
    val session = mediaSession ?: return
    session.setMetadata(
      MediaMetadata.Builder()
        // 常量值见 Android 文档；直接用字面量避免部分 SDK 编译期解析问题
        .putString("android.media.metadata.TITLE", title.ifEmpty { "YTenSUB" })
        .putString("android.media.metadata.ARTIST", "YouTube")
        .build()
    )
    session.setPlaybackState(
      PlaybackState.Builder()
        .setActions(PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE)
        .setState(
          if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED,
          PlaybackState.PLAYBACK_POSITION_UNKNOWN,
          1f
        )
        .build()
    )
    session.isActive = true
    if (playing) acquireWakeLock() else releaseWakeLock()
    val nm = getSystemService(NotificationManager::class.java)
    nm.notify(NOTIF_ID, buildNotification())
  }

  private fun acquireWakeLock() {
    if (wakeLock?.isHeld == true) return
    val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ytensub:bg").apply { acquire() }
  }

  private fun releaseWakeLock() {
    if (wakeLock?.isHeld == true) wakeLock?.release()
    wakeLock = null
  }

  // ---- 音频焦点通道控制 WebView 播放（后台时页面 JS 冻结，注入无效，只有这条路） ----
  private var focusRequest: AudioFocusRequest? = null

  /** 暂停：抢瞬时音频焦点，Chromium 的 AudioFocusDelegate 收到 transient loss 会暂停媒体 */
  private fun pausePlayback() {
    Log.d("BgPlayer", "pausePlayback via audio focus")
    val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
    val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
      .setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
          .build()
      )
      .build()
    focusRequest = req
    am.requestAudioFocus(req)
    updateState(false, title)
  }

  /** 恢复：放弃瞬时焦点，Chromium 重新获得焦点后恢复播放 */
  private fun resumePlayback() {
    Log.d("BgPlayer", "resumePlayback via audio focus")
    val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
    focusRequest?.let { am.abandonAudioFocusRequest(it) }
    focusRequest = null
    updateState(true, title)
  }

  /** 媒体样式通知：播放中显示"暂停"键，暂停时显示"播放"键 */
  private fun buildNotification(): Notification {
    val actionName = if (playing) ACTION_PAUSE else ACTION_PLAY
    val pi = PendingIntent.getService(
      this, 0,
      Intent(this, BgPlayerService::class.java).setAction(actionName),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    val action = Notification.Action.Builder(
      null, if (playing) "暂停" else "播放", pi
    ).build()
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
      Notification.Builder(this, CHANNEL_ID)
    else
      Notification.Builder(this)
    return builder
      .setContentTitle(title.ifEmpty { "YTenSUB 后台播放中" })
      .setSmallIcon(android.R.drawable.ic_media_play)
      .setOngoing(true)
      .addAction(action)
      .setStyle(Notification.MediaStyle().setMediaSession(mediaSession?.sessionToken).setShowActionsInCompactView(0))
      .build()
  }

  override fun onDestroy() {
    releaseWakeLock()
    mediaSession?.release()
    mediaSession = null
    instance = null
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null
}
