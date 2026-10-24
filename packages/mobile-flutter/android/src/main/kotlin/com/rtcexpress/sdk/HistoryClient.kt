package com.rtcexpress.sdk

import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject

class HistoryClient(private val http: OkHttpClient = OkHttpClient()) {
    fun getMessageHistory(
        serverUrl: String,
        token: String,
        roomId: String,
        before: String? = null,
        limit: Int = 50
    ): MessageHistoryPage {
        val base = serverUrl.trimEnd('/')
        val params = mutableListOf("limit=$limit")
        if (!before.isNullOrBlank()) params.add("before=${java.net.URLEncoder.encode(before, Charsets.UTF_8.name())}")
        val query = params.joinToString("&")
        val request = Request.Builder()
            .url("$base/v1/rooms/${java.net.URLEncoder.encode(roomId, Charsets.UTF_8.name())}/messages?$query")
            .header("Authorization", "Bearer $token")
            .get()
            .build()

        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                val err = runCatching { JSONObject(response.body?.string() ?: "{}").optString("error") }.getOrNull()
                throw IllegalStateException(err ?: "Failed to load message history (${response.code})")
            }
            val json = JSONObject(response.body?.string() ?: "{}")
            val messages = mutableListOf<StoredMessage>()
            val arr = json.optJSONArray("messages") ?: JSONArray()
            for (i in 0 until arr.length()) {
                val item = arr.getJSONObject(i)
                messages.add(
                    StoredMessage(
                        id = item.getString("id"),
                        roomId = item.getString("roomId"),
                        fromUserId = item.getString("fromUserId"),
                        text = item.getString("text"),
                        clientMsgId = item.optString("clientMsgId").ifBlank { null },
                        sentAt = item.getString("sentAt")
                    )
                )
            }
            val next = json.optString("nextCursor").ifBlank { null }
            return MessageHistoryPage(messages, next)
        }
    }
}

data class StoredMessage(
    val id: String,
    val roomId: String,
    val fromUserId: String,
    val text: String,
    val clientMsgId: String?,
    val sentAt: String
)

data class MessageHistoryPage(
    val messages: List<StoredMessage>,
    val nextCursor: String?
)
