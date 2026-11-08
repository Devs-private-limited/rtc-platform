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
        /** Someone joined (true) or left (false) group voice/video in [roomId]. */
        fun onMediaParticipant(roomId: String, userId: String, joined: Boolean) {}
        /** About 3 times a second during SFU calls: loudness 0.0-1.0 per user (this user included). */
        fun onAudioLevels(levels: Map<String, Double>) {}
        /** [userId] started (true) or stopped (false) sharing their screen. Your own userId = this phone. */
        fun onScreenShare(userId: String, active: Boolean) {}
        fun onVoiceRoomJoined(roomId: String) {}
        fun onVoiceRoomLeft(roomId: String) {}
        fun onVideoRoomJoined(roomId: String) {}
        fun onVideoRoomLeft(roomId: String) {}
        fun onRecordingStarted() {}
        fun onRecordingStopped(result: RecordingResult) {}
        fun onError(message: String) {}
        fun onDiagnostics(message: String) {}
    }

    private val signaling = SignalingClient()
    private val tokenClient = TokenClient()
    private val configClient = ConfigClient()
    private val historyClient = HistoryClient()
    private val pushClient = PushClient(context)
    private val callRecorder = CallRecorder(context)
    private var p2p: P2pMediaEngine? = null
    private var sfu: SfuMediaEngine? = null

    private var serverUrl = ""
    private var appId = ""
    private var token = ""
    private var userId = ""
    private var roomId: String? = null
    private var listener: Listener? = null
    private var incomingCallNotifier: IncomingCallNotifier? = null

    private var mediaModePref = "p2p"
    private var sfuUrl: String? = null
    // From /v1/config: true only when the app's plan includes server-relayed (SFU) calls.
    private var voiceSfuAllowed = false
    private var videoSfuAllowed = false
    private var planKnown = false
    private var iceServers = listOf(org.webrtc.PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer())
    private var inVoiceRoom = false
    private var inVideoRoom = false

    private var activeCall: ActiveCall? = null
    private var ongoingNotification = true
    private var ongoingSince = 0L
    private var ongoingArgs = Triple("Ongoing call", false, "Tap to return to the call")
    @Volatile private var sharingScreen = false
    private val worker = java.util.concurrent.Executors.newSingleThreadExecutor()
    private var signalingReady = false
    private var pendingJoinRoomId: String? = null

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

    fun setIncomingCallNotifier(notifier: IncomingCallNotifier?) {
        this.incomingCallNotifier = notifier
    }

    fun init(options: RTCInitOptions) {
        serverUrl = options.serverUrl.trimEnd('/')
        appId = options.appId
        userId = options.userId
        token = options.token
        runCatching { configClient.fetchIceServers(serverUrl, token) }
            .onSuccess { if (it.isNotEmpty()) iceServers = it }
        mediaModePref = options.mediaMode
        ongoingNotification = options.ongoingCallNotification
        OngoingCallService.onHangUp = { hangUpEverything() }
        OngoingCallService.onError = { message -> listener?.onDiagnostics(message) }
        signalingReady = false
        signaling.listener = this
        signaling.connect(serverUrl, options.token)
        runCatching {
            val config = configClient.fetchPlatformConfig(serverUrl, appId)
            sfuUrl = config.sfuUrl
            voiceSfuAllowed = config.voiceSfu
            videoSfuAllowed = config.videoSfu
            planKnown = true
        }
    }

    fun joinRoom(roomId: String) {
        this.roomId = roomId
        pendingJoinRoomId = roomId
        flushJoinRoom()
    }

    private fun flushJoinRoom() {
        val id = pendingJoinRoomId ?: return
        if (!signalingReady) return
        signaling.send("join_room", JSONObject().put("roomId", id))
    }

    fun sendMessage(text: String, clientMsgId: String = "") {
        val room = roomId ?: throw IllegalStateException("Join a room first")
        signaling.send(
            "send_message",
            JSONObject().put("roomId", room).put("text", text).apply {
                if (clientMsgId.isNotBlank()) put("clientMsgId", clientMsgId)
            }
        )
    }

    fun getMessageHistory(roomId: String, before: String? = null, limit: Int = 50): MessageHistoryPage {
        return historyClient.getMessageHistory(serverUrl, token, roomId, before, limit)
    }

    /**
     * Register this phone so the signed-in user can receive incoming-call and missed-call
     * notifications while the app is closed. Call after init(), and again whenever Firebase
     * gives a new token. Runs in the background; the callback runs on the main thread.
     */
    fun registerPushDevice(fcmToken: String, callback: ((Result<Unit>) -> Unit)? = null) {
        check(serverUrl.isNotBlank() && token.isNotBlank()) { "Call init() before registerPushDevice()" }
        pushClient.registerDevice(serverUrl, token, fcmToken, callback)
    }

    /** Stop notifications for this user on this phone. Call on logout, before destroy(). */
    fun unregisterPushDevice(callback: ((Result<Unit>) -> Unit)? = null) {
        check(serverUrl.isNotBlank() && token.isNotBlank()) { "Call init() before unregisterPushDevice()" }
        pushClient.unregisterDevice(serverUrl, token, callback)
    }

    /** Optional: report when the app goes to the background or comes back. */
    fun setPushAppState(background: Boolean, callback: ((Result<Unit>) -> Unit)? = null) {
        if (serverUrl.isBlank() || token.isBlank()) return
        pushClient.setAppState(serverUrl, token, background, callback)
    }

    fun joinVoiceRoom() {
        val room = roomId ?: throw IllegalStateException("Join a room first")
        requirePlan(voiceSfuAllowed, "Group voice calls")
        val url = sfuUrl ?: throw IllegalStateException("SFU not available")
        if (sfu == null) {
            sfu = SfuMediaEngine(
                context = context,
                sfuUrl = url,
                userId = userId,
                authToken = token,
                sendSignaling = { type, payload -> signaling.send(type, payload) },
                onRemoteVideo = { track -> listener?.onRemoteVideo(track) },
                onParticipant = { user, joined -> roomId?.let { listener?.onMediaParticipant(it, user, joined) } },
                onAudioLevels = { levels -> listener?.onAudioLevels(levels) },
                onRemoteScreen = { user, active -> listener?.onScreenShare(user, active) },
                onWarning = { message -> listener?.onError(message) }
            )
        }
        try {
            sfu?.joinRoom(room, SfuJoinOptions(audio = true, video = false, announceToRoom = true))
        } catch (e: Exception) {
            sfu?.destroy()
            sfu = null
            throw IllegalStateException("Could not join group voice: ${e.message}")
        }
        inVoiceRoom = true
        startOngoing("Group voice call", false)
        signaling.send("join_media", JSONObject().put("roomId", room).put("kind", "voice"))
        listener?.onVoiceRoomJoined(room)
    }

    fun leaveVoiceRoom() {
        if (!inVoiceRoom) return
        val room = roomId
        if (!inVideoRoom) {
            screenShareEnded()
            sfu?.destroy()
            sfu = null
        }
        inVoiceRoom = false
        stopOngoingIfIdle()
        if (room != null && !inVideoRoom) {
            signaling.send("leave_media", JSONObject().put("roomId", room).put("kind", "voice"))
            listener?.onVoiceRoomLeft(room)
        }
    }

    fun joinVideoRoom() {
        val room = roomId ?: throw IllegalStateException("Join a room first")
        requirePlan(videoSfuAllowed, "Group video calls")
        val url = sfuUrl ?: throw IllegalStateException("SFU not available")
        if (sfu == null) {
            sfu = SfuMediaEngine(
                context = context,
                sfuUrl = url,
                userId = userId,
                authToken = token,
                sendSignaling = { type, payload -> signaling.send(type, payload) },
                onRemoteVideo = { track -> listener?.onRemoteVideo(track) },
                onParticipant = { user, joined -> roomId?.let { listener?.onMediaParticipant(it, user, joined) } },
                onAudioLevels = { levels -> listener?.onAudioLevels(levels) },
                onRemoteScreen = { user, active -> listener?.onScreenShare(user, active) },
                onWarning = { message -> listener?.onError(message) }
            )
        }
        try {
            sfu?.joinRoom(room, SfuJoinOptions(audio = true, video = true, announceToRoom = true))
        } catch (e: Exception) {
            sfu?.destroy()
            sfu = null
            throw IllegalStateException("Could not join group video: ${e.message}")
        }
        inVoiceRoom = true
        inVideoRoom = true
        startOngoing("Group video call", true)
        signaling.send("join_media", JSONObject().put("roomId", room).put("kind", "video"))
        listener?.onVideoRoomJoined(room)
    }

    fun leaveVideoRoom() {
        if (!inVideoRoom) return
        val room = roomId
        screenShareEnded()
        sfu?.destroy()
        sfu = null
        inVideoRoom = false
        inVoiceRoom = false
        stopOngoingIfIdle()
        if (room != null) {
            signaling.send("leave_media", JSONObject().put("roomId", room).put("kind", "video"))
            listener?.onVideoRoomLeft(room)
        }
    }

    fun callUser(peerUserId: String, video: Boolean = false) {
        val room = roomId ?: throw IllegalStateException("Join a room first")
        if (activeCall != null) throw IllegalStateException("Already in a call")
        val callId = JsonUtil.newCallId()
        val callType = if (video) "video" else "voice"
        activeCall = ActiveCall(callId, peerUserId, room, true, callType)
        startOngoing(if (video) "Video call" else "Voice call", video, "Calling $peerUserId")
        if (resolvedMediaMode() == "sfu") {
            signaling.send(
                "call_invite",
                JSONObject()
                    .put("roomId", room)
                    .put("toUserId", peerUserId)
                    .put("callId", callId)
                    .put("callType", callType)
            )
            emitCallState("ringing", peerUserId, room, callId, callType)
            return
        }
        ensureP2p(video)
        signaling.send(
            "call_invite",
            JSONObject()
                .put("roomId", room)
                .put("toUserId", peerUserId)
                .put("callId", callId)
                .put("callType", callType)
        )
        emitCallState("ringing", peerUserId, room, callId, callType)
    }

    fun acceptCall() {
        val call = activeCall ?: throw IllegalStateException("No incoming call")
        signaling.send("call_accept", callPayload(call, call.peerUserId))
        startOngoing(if (call.callType == "video") "Video call" else "Voice call", call.callType == "video", "In call with ${call.peerUserId}")
        if (resolvedMediaMode() == "sfu") {
            if (!startSfuCallOrEnd(call)) return
        } else {
            ensureP2p(call.callType == "video")
        }
        emitCallState("connecting", call.peerUserId, call.roomId, call.callId, call.callType)
    }

    fun rejectCall() {
        val call = activeCall ?: return
        // Always clean up locally, even if the connection already dropped.
        runCatching { signaling.send("call_reject", callPayload(call, call.peerUserId)) }
        cleanupCall("rejected")
    }

    fun endCall() {
        val call = activeCall ?: return
        runCatching { signaling.send("call_end", callPayload(call, call.peerUserId)) }
        cleanupCall("ended")
    }

    fun startRecording() {
        if (activeCall == null && !inVoiceRoom && !inVideoRoom) {
            throw IllegalStateException("Join a call or media room before recording")
        }
        callRecorder.startRecording()
        listener?.onRecordingStarted()
    }

    fun stopRecording(): RecordingResult {
        val result = callRecorder.stopRecording()
        listener?.onRecordingStopped(result)
        return result
    }

    fun isRecording() = callRecorder.isRecording

    fun muteMicrophone(muted: Boolean) {
        sfu?.muteMicrophone(muted) ?: p2p?.muteMicrophone(muted)
    }

    fun muteCamera(muted: Boolean) {
        sfu?.muteCamera(muted) ?: p2p?.muteCamera(muted)
    }

    fun switchCamera() {
        sfu?.switchCamera() ?: p2p?.switchCamera()
    }

    fun destroy() {
        endCall()
        leaveVoiceRoom()
        leaveVideoRoom()
        stopOngoingIfIdle()
        OngoingCallService.onHangUp = null
        OngoingCallService.onError = null
        signaling.listener = null
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
        signalingReady = true
        flushJoinRoom()
        listener?.onConnected(userId)
    }

    override fun onDisconnected() {
        signalingReady = false
        cleanupCall("ended")
        listener?.onDisconnected()
    }

    override fun onRoomJoined(roomId: String, members: List<String>) {
        listener?.onRoomJoined(roomId, members)
    }

    override fun onUserJoined(roomId: String, userId: String) {
        // Presence updates are surfaced via onRoomJoined for now.
    }

    override fun onUserLeft(roomId: String, userId: String) {
        // No-op — room membership is refreshed on the next join.
    }

    override fun onMessage(message: RoomMessage) {
        listener?.onMessage(message)
    }

    override fun onCallInvite(invite: CallInvite) {
        if (activeCall != null) {
            signaling.send(
                "call_reject",
                JSONObject()
                    .put("callId", invite.callId)
                    .put("fromUserId", userId)
                    .put("toUserId", invite.fromUserId)
                    .put("roomId", invite.roomId)
                    .put("callType", invite.callType)
            )
            return
        }
        activeCall = ActiveCall(
            invite.callId,
            invite.fromUserId,
            invite.roomId,
            false,
            invite.callType
        )
        incomingCallNotifier?.onIncomingCall(invite, IncomingCallDisplay.from(invite))
        listener?.onCallInvite(invite)
        emitCallState("ringing", invite.fromUserId, invite.roomId, invite.callId, invite.callType)
    }

    override fun onCallAccept(payload: JSONObject) {
        val call = activeCall ?: return
        if (resolvedMediaMode() == "sfu") {
            if (!startSfuCallOrEnd(call)) return
            emitCallState("connected", call.peerUserId, call.roomId, call.callId, call.callType)
            return
        }
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
        val call = activeCall ?: return
        if (payload.optString("callId") != call.callId) return
        ensureP2p(activeCall?.callType == "video")
        p2p?.handleOffer(payload)
    }

    override fun onWebRtcAnswer(payload: JSONObject) {
        val call = activeCall ?: return
        if (payload.optString("callId") != call.callId) return
        p2p?.handleAnswer(payload)
    }

    override fun onWebRtcIceCandidate(payload: JSONObject) {
        p2p?.handleIceCandidate(payload)
    }

    override fun onSfuProducer(payload: JSONObject) {
        sfu?.handleRemoteProducer(payload)
    }

    override fun onSfuProducerClosed(payload: JSONObject) {
        sfu?.handleRemoteProducerClosed(payload)
    }

    /**
     * Step 1 of screen sharing: launch this Intent with startActivityForResult (Android shows its
     * "Start recording or casting?" dialog). Step 2: pass the result Intent to [startScreenShare].
     */
    fun createScreenShareIntent(): android.content.Intent {
        val manager = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as android.media.projection.MediaProjectionManager
        return manager.createScreenCaptureIntent()
    }

    val isSharingScreen get() = sharingScreen

    /** Throws with a clear message if screen sharing can't start now (call it before showing Android's dialog). */
    fun checkCanShareScreen(): SfuMediaEngine {
        return sfu ?: throw IllegalStateException(
            if (activeCall != null) "Screen sharing needs server-relayed calls: use mediaMode \"auto\" or \"sfu\" on a plan with screen sharing (Pro)."
            else "Join a call or group call before sharing your screen"
        )
    }

    /**
     * Share the screen in the current call or group video/voice room (plan must include screen
     * sharing). [permissionData] = the result Intent from [createScreenShareIntent] (RESULT_OK).
     * Everyone else gets onScreenShare(yourUserId, true). Errors arrive in onError.
     */
    fun startScreenShare(permissionData: android.content.Intent) {
        if (sharingScreen) return
        val engine = checkCanShareScreen()
        if (ongoingSince == 0L) ongoingSince = System.currentTimeMillis()
        // Android 10+: the screen may only be captured while a mediaProjection foreground service runs.
        OngoingCallService.onStarted = { ok ->
            if (!ok) {
                listener?.onError("Could not start screen sharing on this phone")
            } else worker.execute {
                try {
                    engine.startScreenShare(permissionData) { stopScreenShare() }
                    sharingScreen = true
                    listener?.onScreenShare(userId, true)
                } catch (e: Exception) {
                    val message = e.message ?: "unknown error"
                    listener?.onError(
                        if (message.contains("(403)")) "Screen sharing is not included in your current plan. Upgrade your plan to use this feature."
                        else "Could not share your screen: $message"
                    )
                    restoreOngoingAfterScreen()
                }
            }
        }
        val (_, video, text) = ongoingArgs
        if (!OngoingCallService.start(context, "Sharing your screen", text, video, ongoingSince, screen = true)) {
            OngoingCallService.onStarted = null
            listener?.onError("Could not start screen sharing on this phone")
        }
    }

    /** Stop sharing the screen. Also called when the user stops it from Android's own controls. */
    fun stopScreenShare() {
        if (!sharingScreen) return
        sharingScreen = false
        val engine = sfu
        worker.execute { runCatching { engine?.stopScreenShare() } }
        listener?.onScreenShare(userId, false)
        restoreOngoingAfterScreen()
    }

    /** Back to the normal "Ongoing call" notification (or none) after screen sharing. */
    private fun restoreOngoingAfterScreen() {
        val stillInCall = activeCall != null || inVoiceRoom || inVideoRoom
        if (stillInCall && ongoingNotification) {
            val (title, video, text) = ongoingArgs
            OngoingCallService.start(context, title, text, video, ongoingSince)
        } else {
            OngoingCallService.stop(context)
            ongoingSince = 0L
        }
    }

    /** The SFU engine is going away (call ended / left the room): screen sharing ends with it. */
    private fun screenShareEnded() {
        if (!sharingScreen) return
        sharingScreen = false
        listener?.onScreenShare(userId, false)
    }

    override fun onMediaParticipant(payload: JSONObject, joined: Boolean) {
        val room = payload.optString("roomId")
        val who = payload.optString("userId")
        if (room.isBlank() || who.isBlank() || who == userId) return
        if (!joined) sfu?.removeUser(who)
        listener?.onMediaParticipant(room, who, joined)
    }

    override fun onError(message: String, code: String?) {
        // The server refused our call (busy, offline, not in the plan...): don't leave it ringing.
        if (code in listOf("call_busy", "user_offline", "plan_feature_denied", "invalid_call") && activeCall?.isCaller == true) {
            cleanupCall("rejected")
        }
        listener?.onError(message)
    }

    private fun resolvedMediaMode(): String {
        if (mediaModePref == "p2p") return "p2p"
        // Same rule as the Web SDK: SFU only when the server has one AND the plan allows it.
        // Otherwise both sides use peer-to-peer, so a phone and a browser always match.
        if (!voiceSfuAllowed || sfuUrl.isNullOrBlank()) return "p2p"
        return "sfu"
    }

    /** Clear error before trying media the plan does not include (the server enforces the same rule). */
    private fun requirePlan(allowed: Boolean, name: String) {
        if (planKnown && !allowed) {
            throw IllegalStateException("$name are not included in your current plan. Upgrade your plan to use this feature.")
        }
    }

    /** Starts SFU media for a call; if that fails, ends the call for both sides with a clear error. */
    private fun startSfuCallOrEnd(call: ActiveCall): Boolean {
        return try {
            startSfuCall(call)
            true
        } catch (e: Exception) {
            runCatching { signaling.send("call_end", callPayload(call, call.peerUserId)) }
            cleanupCall("failed")
            listener?.onError("Call could not start: ${e.message ?: "media server error"}")
            false
        }
    }

    private fun startSfuCall(call: ActiveCall) {
        val url = sfuUrl ?: throw IllegalStateException("SFU not available")
        if (sfu == null) {
            sfu = SfuMediaEngine(
                context = context,
                sfuUrl = url,
                userId = userId,
                authToken = token,
                sendSignaling = { type, payload -> signaling.send(type, payload) },
                onRemoteVideo = { track -> listener?.onRemoteVideo(track) },
                onParticipant = { user, joined -> roomId?.let { listener?.onMediaParticipant(it, user, joined) } },
                onAudioLevels = { levels -> listener?.onAudioLevels(levels) },
                onRemoteScreen = { user, active -> listener?.onScreenShare(user, active) },
                onWarning = { message -> listener?.onError(message) }
            )
        }
        val sfuRoomId = "${call.roomId}-call-${call.callId}"
        sfu?.joinRoom(
            sfuRoomId,
            SfuJoinOptions(
                audio = true,
                video = call.callType == "video",
                targetUserId = call.peerUserId,
                callId = call.callId
            )
        )
    }

    private fun ensureP2p(video: Boolean) {
        WebRtcPeerFactory.warmUp(context)
        if (p2p == null) {
            p2p = P2pMediaEngine(
                context = context,
                userId = userId,
                iceServers = iceServers,
                sendSignaling = { type, payload -> signaling.send(type, payload) },
                activeCall = {
                    activeCall?.let { it.callId to it.peerUserId }
                }
            ).also {
                it.onRemoteVideoTrack = { track -> listener?.onRemoteVideo(track) }
                it.onDiagnostics = { message -> listener?.onDiagnostics(message) }
                it.onConnectionState = { state ->
                    activeCall?.let { call ->
                        if (state == "failed") {
                            endCall()
                            listener?.onError("Media connection failed. Try another network.")
                        } else emitCallState(state, call.peerUserId, call.roomId, call.callId, call.callType)
                    }
                }
                it.onError = { message ->
                    endCall()
                    listener?.onError(message)
                }
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
        if (!inVoiceRoom && !inVideoRoom) {
            screenShareEnded()
            sfu?.destroy()
            sfu = null
        }
        p2p?.destroy()
        p2p = null
        activeCall = null
        stopOngoingIfIdle()
    }

    /** Foreground service + "Ongoing call" notification while any call or group call is active. */
    private fun startOngoing(title: String, video: Boolean, text: String = "Tap to return to the call") {
        ongoingArgs = Triple(title, video, text)
        if (!ongoingNotification || sharingScreen) return
        if (ongoingSince == 0L) ongoingSince = System.currentTimeMillis()
        if (!OngoingCallService.start(context, title, text, video, ongoingSince)) {
            listener?.onDiagnostics("Ongoing call notification not shown (microphone permission missing or app in background)")
        }
    }

    private fun stopOngoingIfIdle() {
        if (activeCall != null || inVoiceRoom || inVideoRoom || ongoingSince == 0L) return
        ongoingSince = 0L
        OngoingCallService.stop(context)
    }

    /** "Hang up" in the notification, or the app swiped away. */
    private fun hangUpEverything() {
        endCall()
        leaveVideoRoom()
        leaveVoiceRoom()
        stopOngoingIfIdle()
    }
}
