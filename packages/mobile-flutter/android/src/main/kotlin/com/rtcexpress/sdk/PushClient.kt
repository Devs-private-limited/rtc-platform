package com.rtcexpress.sdk

import android.content.Context
import android.os.Handler
import android.os.Looper
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.Executors

/**
 * Registers this phone for RTCExpress push notifications (incoming calls, missed calls, chat alerts).
 *
 * Your app gets the FCM token from Firebase and passes it here. The SDK keeps a random installation
 * ID on the device and calls the RTCExpress API for you. Requests run on a background thread, so it is
 * safe to call these from the main thread or from FirebaseMessagingService.onNewToken().
 *
 * Use it directly when you have no RTCExpress instance (for example in onNewToken), or use the
 * shortcuts on [RTCExpress]: registerPushDevice(), unregisterPushDevice(), setPushAppState().
 */
class PushClient(
    context: Context,
    private val http: OkHttpClient = OkHttpClient()
) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val mainThread = Handler(Looper.getMainLooper())

    /** Stable random ID for this app install. Survives app restarts; a reinstall gets a new one. */
    fun installationId(): String {
        prefs.getString(KEY_INSTALLATION_ID, null)?.let { return it }
        val id = UUID.randomUUID().toString()
        prefs.edit().putString(KEY_INSTALLATION_ID, id).apply()
        return id
    }

    /**
     * Tell RTCExpress that the signed-in user can be reached on this phone.
     * Call after login and every time Firebase gives a new token (onNewToken).
     *
     * @param serverUrl RTCExpress server URL, for example https://api.devsquarelabs.com
     * @param rtcToken the signed-in user's RTC token (from your backend), not the App Secret
     * @param fcmToken token from FirebaseMessaging.getInstance().token
     */
    fun registerDevice(
        serverUrl: String,
        rtcToken: String,
        fcmToken: String,
        callback: ((Result<Unit>) -> Unit)? = null
    ) {
        val body = JSONObject()
            .put("installationId", installationId())
            .put("platform", "android")
            .put("token", fcmToken)
            .put("appState", "foreground")
        run("POST", "${serverUrl.trimEnd('/')}/v1/push/devices", rtcToken, body, callback) {
            prefs.edit().putString(KEY_LAST_FCM_TOKEN, fcmToken).apply()
        }
    }

    /**
     * Stop push notifications for the signed-in user on this phone. Call on logout,
     * while the user's RTC token is still valid.
     */
    fun unregisterDevice(serverUrl: String, rtcToken: String, callback: ((Result<Unit>) -> Unit)? = null) {
        run("DELETE", "${serverUrl.trimEnd('/')}/v1/push/devices/${installationId()}", rtcToken, null, callback) {
            prefs.edit().remove(KEY_LAST_FCM_TOKEN).apply()
        }
    }

    /**
     * Mark the app as in the background or foreground. In the background, chat alerts are
     * delivered even while the socket is still connected. Optional; calls work without it.
     */
    fun setAppState(serverUrl: String, rtcToken: String, background: Boolean, callback: ((Result<Unit>) -> Unit)? = null) {
        val body = JSONObject().put("appState", if (background) "background" else "foreground")
        run("PATCH", "${serverUrl.trimEnd('/')}/v1/push/devices/${installationId()}", rtcToken, body, callback)
    }

    /** The FCM token last registered successfully, or null. Useful to skip duplicate registrations. */
    fun lastRegisteredToken(): String? = prefs.getString(KEY_LAST_FCM_TOKEN, null)

    private fun run(
        method: String,
        url: String,
        rtcToken: String,
        body: JSONObject?,
        callback: ((Result<Unit>) -> Unit)?,
        onSuccess: () -> Unit = {}
    ) {
        require(rtcToken.isNotBlank()) { "An RTC user token is required. Call init() or pass the token from your backend." }
        executor.execute {
            val result = runCatching {
                val requestBody = body?.toString()?.toRequestBody(JSON)
                val request = Request.Builder()
                    .url(url)
                    .header("Authorization", "Bearer $rtcToken")
                    .method(method, requestBody)
                    .build()
                http.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) {
                        val error = runCatching { JSONObject(response.body?.string() ?: "{}").optString("error") }
                            .getOrNull().orEmpty()
                        throw IllegalStateException(error.ifBlank { "Push registration failed (${response.code})" })
                    }
                }
                onSuccess()
            }
            if (callback != null) mainThread.post { callback(result) }
        }
    }

    private companion object {
        const val PREFS = "rtcexpress_push"
        const val KEY_INSTALLATION_ID = "installation_id"
        const val KEY_LAST_FCM_TOKEN = "last_fcm_token"
        val JSON = "application/json; charset=utf-8".toMediaType()
        val executor = Executors.newSingleThreadExecutor()
    }
}
