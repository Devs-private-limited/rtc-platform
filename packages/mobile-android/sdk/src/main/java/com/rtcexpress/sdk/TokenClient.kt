package com.rtcexpress.sdk

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

class TokenClient(private val http: OkHttpClient = OkHttpClient()) {
    fun fetchToken(serverUrl: String, request: TokenRequest): TokenResponse {
        val body = JSONObject()
            .put("appId", request.appId)
            .put("appSecret", request.appSecret)
            .put("userId", request.userId)
        request.roomId?.let { body.put("roomId", it) }

        val httpRequest = Request.Builder()
            .url("${serverUrl.trimEnd('/')}/v1/token")
            .post(body.toString().toRequestBody("application/json".toMediaType()))
            .build()

        http.newCall(httpRequest).execute().use { response ->
            val text = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                val err = runCatching { JSONObject(text).optString("error") }.getOrNull()
                throw IllegalStateException(err ?: "Token request failed (${response.code})")
            }
            val json = JSONObject(text)
            return TokenResponse(
                token = json.getString("token"),
                expiresIn = json.optInt("expiresIn", 3600)
            )
        }
    }

    fun fetchPlatformConfig(serverUrl: String, appId: String? = null): JSONObject {
        val url = buildString {
            append(serverUrl.trimEnd('/'))
            append("/v1/config")
            if (!appId.isNullOrBlank()) append("?appId=").append(appId)
        }
        val request = Request.Builder().url(url).get().build()
        http.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw IllegalStateException("Config request failed")
            return JSONObject(text)
        }
    }
}
