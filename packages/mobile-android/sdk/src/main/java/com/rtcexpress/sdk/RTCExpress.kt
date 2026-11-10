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
        /** [userId] (someone else in the call or group) muted their mic / turned their camera off, or back on. */
        fun onRemoteMediaState(roomId: String, userId: String, audioMuted: Boolean, videoOff: Boolean) {}
        /**
         * [userId] (someone else in the call or group) lost their network ([reconnecting] = true) or
         * is back (false). Show "<name> reconnecting…". Not back in ~30 s = they leave as usual.
         * Your own drops show as onCallState("reconnecting") for calls.
         */
        fun onPeerReconnecting(roomId: String, userId: String, reconnecting: Boolean) {}
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
    // Our own mic/camera state, sent to the others so they can show "muted" / "camera off".
    @Volatile private var localAudioMuted = false
    @Volatile private var localVideoOff = false

    // Reconnect after a network drop during a call or group call (Wi-Fi off, switching networks).
    private val mainHandler = android.os.Handler(android.os.Looper.getMainLooper())
    @Volatile private var reconnecting = false
    private var reconnectAttempt = 0
    private var reconnectStartedAt = 0L
    /** The 1:1 call has media (answered), so a drop should reconnect instead of ending it. */
    @Volatile private var callLive = false
    // From the server's "connected" message (see SignalingClient.Listener.onSessionInfo).
    private var serverCallId: String? = null
    private var serverResumed = false
    private var serverInfoKnown = false
    /** P2P media path lost while signaling stayed up: end the call if it isn't back by then. */
    private var mediaRecoveryDeadline: Runnable? = null

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
            sfu = newSfuEngine(url)
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
        if (activeCall == null && !inVideoRoom) resetMediaState()
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
            sfu = newSfuEngine(url)
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
        if (activeCall == null) resetMediaState()
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
            callLive = true
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
        localAudioMuted = muted
        sendMediaState()
    }

    fun muteCamera(muted: Boolean) {
        sfu?.muteCamera(muted) ?: p2p?.muteCamera(muted)
        localVideoOff = muted
        sendMediaState()
    }

    /** Tell the others in the call/group our mic/camera state ([onlyIfChanged]: skip when all is on). */
    private fun sendMediaState(onlyIfChanged: Boolean = false) {
        val room = activeCall?.roomId ?: (if (inVoiceRoom || inVideoRoom) roomId else null) ?: return
        if (onlyIfChanged && !localAudioMuted && !localVideoOff) return
        runCatching {
            signaling.send(
                "media_state",
                JSONObject().put("roomId", room).put("audioMuted", localAudioMuted).put("videoOff", localVideoOff)
            )
        }
    }

    private fun resetMediaState() {
        localAudioMuted = false
        localVideoOff = false
    }

    override fun onMediaState(payload: JSONObject) {
        val room = payload.optString("roomId")
        val who = payload.optString("userId")
        if (room.isBlank() || who.isBlank() || who == userId) return
        listener?.onRemoteMediaState(room, who, payload.optBoolean("audioMuted"), payload.optBoolean("videoOff"))
    }

    fun switchCamera() {
        sfu?.switchCamera() ?: p2p?.switchCamera()
    }

    fun destroy() {
        reconnecting = false
        mainHandler.removeCallbacksAndMessages(RECONNECT_TOKEN)
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
        /** How long to keep trying after a network drop before the call ends (server waits ~30 s too). */
        private const val RECONNECT_WINDOW_MS = 30_000L
        private val RECONNECT_TOKEN = Any()

        fun fetchToken(serverUrl: String, request: TokenRequest): TokenResponse {
            return TokenClient().fetchToken(serverUrl, request)
        }
    }

    override fun onSessionInfo(callId: String?, resumed: Boolean, known: Boolean) {
        serverCallId = callId
        serverResumed = resumed
        serverInfoKnown = known
    }

    override fun onConnected(userId: String) {
        signalingReady = true
        flushJoinRoom()
        val wasReconnecting = reconnecting
        if (wasReconnecting) {
            reconnecting = false
            mainHandler.removeCallbacksAndMessages(RECONNECT_TOKEN)
            resumeAfterReconnect()
        }
        listener?.onConnected(userId)
    }

    override fun onDisconnected() {
        signalingReady = false
        if (reconnecting) {
            scheduleReconnectAttempt() // this attempt failed: try again soon
            return
        }
        val inCallOrGroup = (activeCall != null && callLive) || inVoiceRoom || inVideoRoom
        if (inCallOrGroup && !signaling.tokenRejected && serverUrl.isNotBlank()) {
            // Network dropped mid-call: keep the call and reconnect (~30 s), like WhatsApp.
            reconnecting = true
            reconnectAttempt = 0
            reconnectStartedAt = System.currentTimeMillis()
            activeCall?.let { emitCallState("reconnecting", it.peerUserId, it.roomId, it.callId, it.callType) }
            listener?.onDisconnected()
            scheduleReconnectAttempt()
            return
        }
        cleanupCall("ended")
        listener?.onDisconnected()
    }

    private fun scheduleReconnectAttempt() {
        val delay = minOf(1000L shl minOf(reconnectAttempt, 3), 5000L) // 1, 2, 4, 5, 5... s
        reconnectAttempt++
        mainHandler.postAtTime({
            if (!reconnecting) return@postAtTime
            if (System.currentTimeMillis() - reconnectStartedAt > RECONNECT_WINDOW_MS || signaling.tokenRejected) {
                giveUpReconnect()
                return@postAtTime
            }
            signaling.connect(serverUrl, token)
        }, RECONNECT_TOKEN, android.os.SystemClock.uptimeMillis() + delay)
    }

    /** The network did not come back in time: end the call / group call on this phone. */
    private fun giveUpReconnect() {
        reconnecting = false
        mainHandler.removeCallbacksAndMessages(RECONNECT_TOKEN)
        cleanupCall("ended")
        dropGroupMediaLocally()
        listener?.onError("Call ended: the connection did not come back")
    }

    /** Leave group voice/video on this phone only (the server already removed us). */
    private fun dropGroupMediaLocally() {
        if (!inVoiceRoom && !inVideoRoom) return
        val room = roomId
        val wasVideo = inVideoRoom
        screenShareEnded()
        sfu?.destroy()
        sfu = null
        inVoiceRoom = false
        inVideoRoom = false
        if (activeCall == null) resetMediaState()
        stopOngoingIfIdle()
        if (room != null) {
            if (wasVideo) listener?.onVideoRoomLeft(room) else listener?.onVoiceRoomLeft(room)
        }
    }

    /** Back online after a drop: keep the call / group call going on a new network path. */
    private fun resumeAfterReconnect() {
        val call = activeCall
        if (call != null && callLive) {
            if (serverInfoKnown && serverCallId != call.callId) {
                cleanupCall("ended") // away too long: the server already ended the call
            } else {
                try {
                    val engine = sfu
                    val p2pEngine = p2p
                    if (engine != null && resolvedMediaMode() == "sfu") {
                        if (!engine.isMediaHealthy()) rebuildSfu()
                        emitCallState("connected", call.peerUserId, call.roomId, call.callId, call.callType)
                    } else if (p2pEngine != null) {
                        // "connected" comes from the P2P engine once the new path works.
                        if (p2pEngine.isConnected()) emitCallState("connected", call.peerUserId, call.roomId, call.callId, call.callType)
                        else p2pEngine.restartIce(call.peerUserId, call.callId)
                    }
                    sendMediaState(onlyIfChanged = true)
                } catch (e: Exception) {
                    runCatching { signaling.send("call_end", callPayload(call, call.peerUserId)) }
                    cleanupCall("failed")
                    listener?.onError("Call ended: could not reconnect the media (${e.message})")
                }
            }
        }
        if (inVoiceRoom || inVideoRoom) {
            if (serverResumed && sfu != null) {
                try {
                    if (sfu?.isMediaHealthy() == false) rebuildSfu()
                    sendMediaState(onlyIfChanged = true)
                } catch (e: Exception) {
                    listener?.onError("Left the group call: could not reconnect the media (${e.message})")
                    runCatching { leaveVideoRoom() }
                    runCatching { leaveVoiceRoom() }
                }
            } else {
                // Away too long: the server removed us from the group call. Join it again.
                val video = inVideoRoom
                screenShareEnded()
                sfu?.destroy()
                sfu = null
                inVoiceRoom = false
                inVideoRoom = false
                try {
                    if (video) joinVideoRoom() else joinVoiceRoom()
                } catch (e: Exception) {
                    listener?.onError(e.message ?: "Could not rejoin the group call")
                    if (activeCall == null) resetMediaState()
                    stopOngoingIfIdle()
                    roomId?.let { if (video) listener?.onVideoRoomLeft(it) else listener?.onVoiceRoomLeft(it) }
                }
            }
        }
    }

    /** Join the media server again with fresh connections (the old network path is gone). Blocking. */
    private fun rebuildSfu() {
        val old = sfu ?: return
        val snap = old.snapshot()
        val wasSharing = sharingScreen
        screenShareEnded() // the screen share was on the old connection
        old.destroy()
        sfu = null
        if (wasSharing) restoreOngoingAfterScreen()
        val room = snap.roomId ?: return
        val url = sfuUrl ?: throw IllegalStateException("SFU not available")
        val engine = newSfuEngine(url)
        sfu = engine
        engine.joinRoom(room, snap.options)
        engine.closeOldProducers(snap) // after joining, so the others already show our new media
        if (localAudioMuted) engine.muteMicrophone(true)
        if (localVideoOff) engine.muteCamera(true)
    }

    override fun onPeerReconnect(payload: JSONObject, reconnecting: Boolean) {
        val room = payload.optString("roomId")
        val who = payload.optString("userId")
        if (who.isBlank() || who == userId) return
        listener?.onPeerReconnecting(room, who, reconnecting)
        val call = activeCall ?: return
        if (callLive && payload.optString("callId") == call.callId) {
            emitCallState(if (reconnecting) "reconnecting" else "connected", call.peerUserId, call.roomId, call.callId, call.callType)
        }
    }

    /** P2P only: the media path broke but signaling is fine. Try an ICE restart; end after ~30 s. */
    private fun recoverP2pMedia(call: ActiveCall) {
        emitCallState("reconnecting", call.peerUserId, call.roomId, call.callId, call.callType)
        if (signalingReady) runCatching { p2p?.restartIce(call.peerUserId, call.callId) }
        if (mediaRecoveryDeadline != null) return
        val deadline = Runnable {
            mediaRecoveryDeadline = null
            if (activeCall?.callId == call.callId && p2p?.isConnected() != true && !reconnecting) {
                endCall()
                listener?.onError("Media connection failed. Try another network.")
            }
        }
        mediaRecoveryDeadline = deadline
        mainHandler.postDelayed(deadline, RECONNECT_WINDOW_MS)
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
            // Answered: say so now (joining the media server takes a moment), so both timers start together.
            emitCallState("connecting", call.peerUserId, call.roomId, call.callId, call.callType)
            if (!startSfuCallOrEnd(call)) return
            callLive = true
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
        if (joined) sendMediaState(onlyIfChanged = true) // the newcomer should see that we're muted
    }

    override fun onError(message: String, code: String?) {
        // Failed reconnect attempts are expected while the network is down: no error for each one.
        if (code == "connection_failed" && reconnecting) return
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
            sfu = newSfuEngine(url)
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

    private fun newSfuEngine(url: String) = SfuMediaEngine(
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
                        when (state) {
                            "failed" -> recoverP2pMedia(call)
                            "connected" -> {
                                callLive = true
                                mediaRecoveryDeadline?.let { d -> mainHandler.removeCallbacks(d) }
                                mediaRecoveryDeadline = null
                                emitCallState(state, call.peerUserId, call.roomId, call.callId, call.callType)
                            }
                            "reconnecting" -> if (callLive) emitCallState(state, call.peerUserId, call.roomId, call.callId, call.callType)
                            else -> emitCallState(state, call.peerUserId, call.roomId, call.callId, call.callType)
                        }
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
        if (state == "connected") sendMediaState(onlyIfChanged = true)
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
        callLive = false
        mediaRecoveryDeadline?.let { mainHandler.removeCallbacks(it) }
        mediaRecoveryDeadline = null
        if (!inVoiceRoom && !inVideoRoom) resetMediaState() // the next call starts with mic and camera on
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
