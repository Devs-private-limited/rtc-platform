package com.rtcexpress.sdk

import android.content.Context
import org.json.JSONObject
import org.webrtc.VideoTrack

class RTCExpress(private val context: Context) : SignalingClient.Listener {
    interface Listener {
        fun onConnected(userId: String) {}
        fun onDisconnected() {}
        fun onRoomJoined(roomId: String, members: List<String>) {}
        fun onMessage(message: RoomMessage) {}
        fun onCallInvite(invite: CallInvite) {}
        fun onCallState(update: CallStateUpdate) {}
        fun onRemoteVideo(track: VideoTrack) {}
        fun onError(message: String) {}
    }

    private val signaling = SignalingClient()
    private val tokenClient = TokenClient()
    private var p2p: P2pMediaEngine? = null

    private var serverUrl = ""
    private var userId = ""
    private var roomId: String? = null
    private var listener: Listener? = null

    private var activeCall: ActiveCall? = null

    private data class ActiveCall(
        val callId: String,
        val peerUserId: String,
        val roomId: String,
        val isCaller: Boolean,
        val callType: String
    )

    fun setListener(listener: Listener?) {
        this.listener = listener
    }

    fun init(options: RTCInitOptions) {
        serverUrl = options.serverUrl.trimEnd('/')
        userId = options.userId
        signaling.listener = this
        signaling.connect(serverUrl, options.token)
    }

    fun joinRoom(roomId: String) {
        this.roomId = roomId
        signaling.send("join_room", JSONObject().put("roomId", roomId))
    }

    fun sendMessage(text: String) {
        val room = roomId ?: throw IllegalStateException("Join a room first")
        signaling.send(
            "send_message",
            JSONObject().put("roomId", room).put("text", text)
        )
    }

    fun callUser(peerUserId: String, video: Boolean = false) {
        val room = roomId ?: throw IllegalStateException("Join a room first")
        val callId = JsonUtil.newCallId()
        activeCall = ActiveCall(callId, peerUserId, room, true, if (video) "video" else "voice")
        ensureP2p(video)
        signaling.send(
            "call_invite",
            JSONObject()
                .put("roomId", room)
                .put("toUserId", peerUserId)
                .put("callId", callId)
                .put("callType", if (video) "video" else "voice")
        )
        emitCallState("ringing", peerUserId, room, callId, activeCall!!.callType)
    }

    fun acceptCall() {
        val call = activeCall ?: throw IllegalStateException("No incoming call")
        signaling.send(
            "call_accept",
            callPayload(call, call.peerUserId)
        )
        ensureP2p(call.callType == "video")
        if (!call.isCaller) {
            // Callee waits for offer
        }
        emitCallState("connecting", call.peerUserId, call.roomId, call.callId, call.callType)
    }

    fun rejectCall() {
        val call = activeCall ?: return
        signaling.send("call_reject", callPayload(call, call.peerUserId))
        cleanupCall("rejected")
    }

    fun endCall() {
        val call = activeCall ?: return
        signaling.send("call_end", callPayload(call, call.peerUserId))
        cleanupCall("ended")
    }

    fun muteMicrophone(muted: Boolean) {
        p2p?.muteMicrophone(muted)
    }

    fun muteCamera(muted: Boolean) {
        p2p?.muteCamera(muted)
    }

    fun switchCamera() {
        p2p?.switchCamera()
    }

    fun destroy() {
        endCall()
        signaling.close()
        p2p?.destroy()
        p2p = null
    }

    companion object {
        fun fetchToken(serverUrl: String, request: TokenRequest): TokenResponse {
            return TokenClient().fetchToken(serverUrl, request)
        }
    }

    override fun onConnected(userId: String) {
        listener?.onConnected(userId)
    }

    override fun onDisconnected() {
        listener?.onDisconnected()
    }

    override fun onRoomJoined(roomId: String, members: List<String>) {
        listener?.onRoomJoined(roomId, members)
    }

    override fun onMessage(message: RoomMessage) {
        listener?.onMessage(message)
    }

    override fun onCallInvite(invite: CallInvite) {
        activeCall = ActiveCall(
            invite.callId,
            invite.fromUserId,
            invite.roomId,
            false,
            invite.callType
        )
        listener?.onCallInvite(invite)
        emitCallState("ringing", invite.fromUserId, invite.roomId, invite.callId, invite.callType)
    }

    override fun onCallAccept(payload: JSONObject) {
        val call = activeCall ?: return
        ensureP2p(call.callType == "video")
        p2p?.createOffer(call.peerUserId, call.callId)
        emitCallState("connecting", call.peerUserId, call.roomId, call.callId, call.callType)
    }

    override fun onCallReject(payload: JSONObject) {
        cleanupCall("rejected")
    }

    override fun onCallEnd(payload: JSONObject) {
        cleanupCall("ended")
    }

    override fun onWebRtcOffer(payload: JSONObject) {
        ensureP2p(activeCall?.callType == "video")
        p2p?.handleOffer(payload)
        activeCall?.let {
            emitCallState("connected", it.peerUserId, it.roomId, it.callId, it.callType)
        }
    }

    override fun onWebRtcAnswer(payload: JSONObject) {
        p2p?.handleAnswer(payload)
        activeCall?.let {
            emitCallState("connected", it.peerUserId, it.roomId, it.callId, it.callType)
        }
    }

    override fun onIceCandidate(payload: JSONObject) {
        p2p?.handleIceCandidate(payload)
    }

    override fun onError(message: String) {
        listener?.onError(message)
    }

    private fun ensureP2p(video: Boolean) {
        if (p2p == null) {
            p2p = P2pMediaEngine(
                context = context,
                userId = userId,
                sendSignaling = { type, payload -> signaling.send(type, payload) },
                activeCall = {
                    activeCall?.let { it.callId to it.peerUserId }
                }
            ).also {
                it.onRemoteVideoTrack = { track -> listener?.onRemoteVideo(track) }
            }
        }
        p2p?.prepare(video)
    }

    private fun callPayload(call: ActiveCall, toUserId: String): JSONObject {
        return JSONObject()
            .put("callId", call.callId)
            .put("fromUserId", userId)
            .put("toUserId", toUserId)
            .put("roomId", call.roomId)
            .put("callType", call.callType)
    }

    private fun emitCallState(state: String, peerUserId: String, roomId: String, callId: String, callType: String) {
        listener?.onCallState(CallStateUpdate(callId, state, peerUserId, roomId, callType))
    }

    private fun cleanupCall(state: String) {
        val call = activeCall ?: return
        emitCallState(state, call.peerUserId, call.roomId, call.callId, call.callType)
        p2p?.destroy()
        p2p = null
        activeCall = null
    }
}
