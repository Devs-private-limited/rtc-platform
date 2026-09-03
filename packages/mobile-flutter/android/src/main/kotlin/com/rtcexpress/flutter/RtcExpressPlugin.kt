package com.rtcexpress.flutter

import android.content.Context
import com.rtcexpress.sdk.CallInvite
import com.rtcexpress.sdk.CallStateUpdate
import com.rtcexpress.sdk.RTCExpress
import com.rtcexpress.sdk.RTCInitOptions
import com.rtcexpress.sdk.RoomMessage
import com.rtcexpress.sdk.TokenClient
import com.rtcexpress.sdk.TokenRequest
import io.flutter.embedding.engine.plugins.FlutterPlugin
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

class RtcExpressPlugin : FlutterPlugin, MethodChannel.MethodCallHandler, RTCExpress.Listener {
    private lateinit var channel: MethodChannel
    private lateinit var events: EventChannel
    private var eventSink: EventChannel.EventSink? = null
    private var rtc: RTCExpress? = null
    private var appContext: Context? = null

    override fun onAttachedToEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        appContext = binding.applicationContext
        channel = MethodChannel(binding.binaryMessenger, "rtcexpress")
        channel.setMethodCallHandler(this)
        events = EventChannel(binding.binaryMessenger, "rtcexpress/events")
        events.setStreamHandler(object : EventChannel.StreamHandler {
            override fun onListen(arguments: Any?, events: EventChannel.EventSink?) {
                eventSink = events
            }

            override fun onCancel(arguments: Any?) {
                eventSink = null
            }
        })
    }

    override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        channel.setMethodCallHandler(null)
        rtc?.destroy()
        rtc = null
    }

    private fun emit(event: String, data: Map<String, Any?>) {
        eventSink?.success(mapOf("event" to event, "data" to data))
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "fetchToken" -> {
                val serverUrl = call.argument<String>("serverUrl") ?: ""
                val req = call.argument<Map<String, Any>>("request") ?: emptyMap()
                try {
                    val response = TokenClient().fetchToken(
                        serverUrl,
                        TokenRequest(
                            appId = req["appId"] as? String ?: "",
                            appSecret = req["appSecret"] as? String ?: "",
                            userId = req["userId"] as? String ?: "",
                            roomId = req["roomId"] as? String
                        )
                    )
                    result.success(mapOf("token" to response.token, "expiresIn" to response.expiresIn))
                } catch (e: Exception) {
                    result.error("token_error", e.message, null)
                }
            }
            "init" -> {
                val ctx = appContext ?: return result.error("no_context", "No context", null)
                val opts = call.arguments as? Map<*, *> ?: emptyMap<String, Any>()
                rtc = RTCExpress(ctx).also {
                    it.setListener(this)
                    it.init(
                        RTCInitOptions(
                            serverUrl = opts["serverUrl"] as? String ?: "",
                            appId = opts["appId"] as? String ?: "",
                            userId = opts["userId"] as? String ?: "",
                            token = opts["token"] as? String ?: "",
                            mediaMode = opts["mediaMode"] as? String ?: "auto"
                        )
                    )
                }
                result.success(null)
            }
            "joinRoom" -> {
                rtc?.joinRoom(call.argument<String>("roomId") ?: "")
                result.success(null)
            }
            "sendMessage" -> {
                rtc?.sendMessage(call.argument<String>("text") ?: "")
                result.success(null)
            }
            "callUser" -> {
                rtc?.callUser(
                    call.argument<String>("peerUserId") ?: "",
                    call.argument<Boolean>("video") ?: false
                )
                result.success(null)
            }
            "acceptCall" -> { rtc?.acceptCall(); result.success(null) }
            "rejectCall" -> { rtc?.rejectCall(); result.success(null) }
            "endCall" -> { rtc?.endCall(); result.success(null) }
            "muteMicrophone" -> {
                rtc?.muteMicrophone(call.argument<Boolean>("muted") ?: false)
                result.success(null)
            }
            "muteCamera" -> {
                rtc?.muteCamera(call.argument<Boolean>("muted") ?: false)
                result.success(null)
            }
            "switchCamera" -> { rtc?.switchCamera(); result.success(null) }
            "destroy" -> { rtc?.destroy(); rtc = null; result.success(null) }
            else -> result.notImplemented()
        }
    }

    override fun onConnected(userId: String) = emit("connected", mapOf("userId" to userId))
    override fun onDisconnected() = emit("disconnected", emptyMap())
    override fun onRoomJoined(roomId: String, members: List<String>) =
        emit("roomJoined", mapOf("roomId" to roomId, "members" to members))
    override fun onMessage(message: RoomMessage) =
        emit("message", mapOf(
            "roomId" to message.roomId,
            "fromUserId" to message.fromUserId,
            "text" to message.text,
            "sentAt" to message.sentAt
        ))
    override fun onCallInvite(invite: CallInvite) =
        emit("callInvite", mapOf(
            "callId" to invite.callId,
            "roomId" to invite.roomId,
            "fromUserId" to invite.fromUserId,
            "callType" to invite.callType
        ))
    override fun onCallState(update: CallStateUpdate) =
        emit("callState", mapOf(
            "callId" to update.callId,
            "state" to update.state,
            "peerUserId" to update.peerUserId,
            "roomId" to update.roomId,
            "callType" to update.callType
        ))
    override fun onRemoteVideo(track: org.webrtc.VideoTrack) =
        emit("remoteVideo", mapOf("trackId" to track.id()))
    override fun onError(message: String) = emit("error", mapOf("message" to message))
}
