package com.rtcexpress.sdk

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * Keeps a call alive while the user is in another app (or the screen is off), like WhatsApp:
 * Android only lets an app use the microphone/camera in the background from a foreground
 * service with an "Ongoing call" notification. The SDK starts and stops it by itself
 * (turn it off with RTCInitOptions.ongoingCallNotification = false).
 * Tapping the notification opens the app; "Hang up" ends the call.
 */
class OngoingCallService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_HANG_UP) {
            onHangUp?.invoke()
            stopSelf()
            return START_NOT_STICKY
        }
        val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Ongoing call"
        val text = intent?.getStringExtra(EXTRA_TEXT) ?: "Tap to return to the call"
        val video = intent?.getBooleanExtra(EXTRA_VIDEO, false) ?: false
        val startedAt = intent?.getLongExtra(EXTRA_STARTED_AT, System.currentTimeMillis()) ?: System.currentTimeMillis()
        val notification = buildNotification(title, text, startedAt)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                var type = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                if (video && granted(Manifest.permission.CAMERA)) type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
                startForeground(NOTIFICATION_ID, notification, type)
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (e: Exception) {
            // e.g. microphone permission not granted (Android 14): the call still works while the app is open.
            onError?.invoke("Ongoing call notification could not start: ${e.message}")
            stopSelf()
        }
        return START_NOT_STICKY
    }

    /** The user swiped the app away from recent apps: end the call instead of leaving it half-alive. */
    override fun onTaskRemoved(rootIntent: Intent?) {
        onHangUp?.invoke()
        stopSelf()
    }

    private fun granted(permission: String) = checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

    private fun buildNotification(title: String, text: String, startedAt: Long): Notification {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL_ID) == null) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Ongoing calls", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Shown while a call is active"
                    setShowBadge(false)
                }
            )
        }
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val open = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
        }
        val openPending = open?.let { PendingIntent.getActivity(this, 0, it, flags) }
        val hangUpPending = PendingIntent.getService(
            this, 1, Intent(this, OngoingCallService::class.java).setAction(ACTION_HANG_UP), flags
        )
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, CHANNEL_ID)
        else @Suppress("DEPRECATION") Notification.Builder(this)
        builder
            .setSmallIcon(smallIcon.takeIf { it != 0 } ?: applicationInfo.icon)
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_CALL)
            .setWhen(startedAt)
            .setUsesChronometer(true)
            .setShowWhen(true)
            .addAction(Notification.Action.Builder(null, "Hang up", hangUpPending).build())
        openPending?.let { builder.setContentIntent(it) }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
        return builder.build()
    }

    companion object {
        private const val CHANNEL_ID = "rtcexpress_ongoing_call"
        private const val NOTIFICATION_ID = 48211
        private const val ACTION_HANG_UP = "com.rtcexpress.sdk.HANG_UP"
        private const val EXTRA_TITLE = "title"
        private const val EXTRA_TEXT = "text"
        private const val EXTRA_VIDEO = "video"
        private const val EXTRA_STARTED_AT = "startedAt"

        /** Notification icon (drawable resource). Default: the app icon. */
        @JvmStatic var smallIcon: Int = 0
        internal var onHangUp: (() -> Unit)? = null
        internal var onError: ((String) -> Unit)? = null

        internal fun start(context: Context, title: String, text: String, video: Boolean, startedAt: Long): Boolean {
            // Without microphone permission Android would refuse the service (and could crash the app).
            if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) return false
            val intent = Intent(context, OngoingCallService::class.java)
                .putExtra(EXTRA_TITLE, title)
                .putExtra(EXTRA_TEXT, text)
                .putExtra(EXTRA_VIDEO, video)
                .putExtra(EXTRA_STARTED_AT, startedAt)
            return try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
                true
            } catch (e: Exception) {
                // Android 12+ refuses to start it while the app is in the background.
                onError?.invoke("Ongoing call notification could not start: ${e.message}")
                false
            }
        }

        internal fun stop(context: Context) {
            runCatching { context.stopService(Intent(context, OngoingCallService::class.java)) }
        }
    }
}
