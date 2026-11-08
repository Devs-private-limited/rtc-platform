package com.rtcexpress.sdk

import android.content.Context
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import org.mediasoup.droid.Consumer
import org.mediasoup.droid.Device
import org.mediasoup.droid.MediasoupClient
import org.mediasoup.droid.Producer
import org.mediasoup.droid.RecvTransport
import org.mediasoup.droid.SendTransport
import org.mediasoup.droid.Transport
import org.webrtc.AudioSource
import org.webrtc.AudioTrack
import org.webrtc.Camera2Enumerator
import org.webrtc.MediaConstraints
import org.webrtc.PeerConnectionFactory
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoCapturer
import org.webrtc.VideoSource
import org.webrtc.VideoTrack

class SfuMediaEngine(
    private val context: Context,
    private val sfuUrl: String,
    private val userId: String,
    private val authToken: String,
    private val sendSignaling: (String, JSONObject) -> Unit,
    private val onRemoteVideo: (VideoTrack) -> Unit,
    /** A remote person's media arrived (true) or they left (false). */
    private val onParticipant: (String, Boolean) -> Unit = { _, _ -> },
    /** Every 300 ms: how loud each person is (0.0-1.0), including this user. */
    private val onAudioLevels: (Map<String, Double>) -> Unit = {},
    /** A remote person started (true) or stopped (false) sharing their screen. */
    private val onRemoteScreen: (String, Boolean) -> Unit = { _, _ -> }
) {
    private val http = OkHttpClient()
    // Shared with P2P calls and CallVideoView: video frames can only be drawn by views
    // that use the same EGL context, so SFU video must use the same factory.
    private val factory: PeerConnectionFactory
    private var audioSource: AudioSource? = null
    private var videoSource: VideoSource? = null
    private var captureHelper: SurfaceTextureHelper? = null
    private var device: Device? = null
    private var sendTransport: SendTransport? = null
    private var recvTransport: RecvTransport? = null
    private var roomId: String? = null
    private var audioTrack: AudioTrack? = null
    private var videoTrack: VideoTrack? = null
    private var videoCapturer: VideoCapturer? = null
    private var micProducer: Producer? = null
    private var camProducer: Producer? = null
    private val consumers = mutableMapOf<String, Consumer>()
    private val consumerUsers = mutableMapOf<String, String>() // producerId -> userId
    private val screenConsumers = mutableSetOf<String>() // producerIds that are shared screens
    // Which media the next send.produce() call is for (sent to the SFU and to the others).
    @Volatile private var pendingSource = "microphone"
    private var joinOptions = SfuJoinOptions()
    private var screenCapturer: VideoCapturer? = null
    private var screenHelper: SurfaceTextureHelper? = null
    private var screenSource: VideoSource? = null
    private var screenTrack: VideoTrack? = null
    private var screenProducer: Producer? = null
    private val lock = Any()
    private var levelTimer: java.util.Timer? = null
    private var micMuted = false
    private var usingFrontCamera = true
    // Call audio: loudspeaker + voice-call mode (echo cancellation), same as 1:1 P2P calls.
    private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as android.media.AudioManager
    private var previousMode = android.media.AudioManager.MODE_NORMAL
    private var previousSpeaker = false
    private var audioFocus: android.media.AudioFocusRequest? = null
    private var callAudioOn = false

    private fun startCallAudio() {
        if (callAudioOn) return
        callAudioOn = true
        runCatching {
            previousMode = audioManager.mode
            @Suppress("DEPRECATION")
            previousSpeaker = audioManager.isSpeakerphoneOn
            audioManager.mode = android.media.AudioManager.MODE_IN_COMMUNICATION
            if (android.os.Build.VERSION.SDK_INT >= 31) {
                audioManager.availableCommunicationDevices.firstOrNull { it.type == android.media.AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
                    ?.let { audioManager.setCommunicationDevice(it) }
            } else {
                @Suppress("DEPRECATION")
                audioManager.isSpeakerphoneOn = true
            }
            if (android.os.Build.VERSION.SDK_INT >= 26) {
                audioFocus = android.media.AudioFocusRequest.Builder(android.media.AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                    .setAudioAttributes(
                        android.media.AudioAttributes.Builder()
                            .setUsage(android.media.AudioAttributes.USAGE_VOICE_COMMUNICATION)
                            .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build()
                    )
                    .setOnAudioFocusChangeListener { }
                    .build()
                audioManager.requestAudioFocus(audioFocus!!)
            }
        }
    }

    private fun stopCallAudio() {
        if (!callAudioOn) return
        callAudioOn = false
        runCatching {
            if (android.os.Build.VERSION.SDK_INT >= 26) audioFocus?.let { audioManager.abandonAudioFocusRequest(it) }
            if (android.os.Build.VERSION.SDK_INT >= 31) audioManager.clearCommunicationDevice()
            else {
                @Suppress("DEPRECATION")
                audioManager.isSpeakerphoneOn = previousSpeaker
            }
            audioManager.mode = previousMode
        }
    }

    init {
        MediasoupClient.initialize(context)
        WebRtcPeerFactory.warmUp(context)
        factory = WebRtcPeerFactory.factory()
    }

    fun joinRoom(roomId: String, options: SfuJoinOptions) {
        this.roomId = roomId
        joinOptions = options
        val base = sfuUrl.trimEnd('/')
        val joinJson = postJson(
            "$base/v1/rooms/${encode(roomId)}/join",
            JSONObject().put("peerId", userId)
        )
        val rtpCapabilities = joinJson.getJSONObject("rtpCapabilities").toString()
        startCallAudio()

        val mediasoupDevice = Device()
        // Same factory (and EGL context) as CallVideoView, so remote SFU video can be drawn.
        val pcOptions = org.mediasoup.droid.PeerConnection.Options().apply { setFactory(factory) }
        mediasoupDevice.load(rtpCapabilities, pcOptions)
        device = mediasoupDevice

        createSendTransport(base, roomId, options)
        createRecvTransport(base, roomId)
        if (options.audio || options.video) publishCameraMic(options)
        consumeExisting(base, roomId)
        startLevelTimer()
    }

    /** Someone left the group call: stop their audio/video right away. */
    fun removeUser(remoteUserId: String) {
        var hadScreen = false
        val closed = synchronized(lock) {
            val ids = consumerUsers.filterValues { it == remoteUserId }.keys.toList()
            ids.forEach { id ->
                runCatching { consumers.remove(id)?.close() }
                consumerUsers.remove(id)
                if (screenConsumers.remove(id)) hadScreen = true
            }
            ids.isNotEmpty()
        }
        CallVideoTracks.updateUser(remoteUserId, null)
        if (hadScreen) {
            CallVideoTracks.updateScreen(remoteUserId, null)
            onRemoteScreen(remoteUserId, false)
        }
        if (closed) onParticipant(remoteUserId, false)
    }

    private fun startLevelTimer() {
        levelTimer?.cancel()
        levelTimer = java.util.Timer("rtc-audio-levels", true).apply {
            scheduleAtFixedRate(object : java.util.TimerTask() {
                override fun run() {
                    val levels = runCatching { readLevels() }.getOrNull() ?: return
                    if (levels.isNotEmpty()) runCatching { onAudioLevels(levels) }
                }
            }, 500, 300)
        }
    }

    private fun readLevels(): Map<String, Double> = synchronized(lock) {
        val out = mutableMapOf<String, Double>()
        for ((producerId, consumer) in consumers) {
            if (consumer.kind != "audio") continue
            val user = consumerUsers[producerId] ?: continue
            val level = runCatching { audioLevelOf(consumer.getStats()) }.getOrDefault(0.0)
            out[user] = maxOf(out[user] ?: 0.0, level)
        }
        micProducer?.let { mic ->
            out[userId] = if (micMuted) 0.0 else runCatching { audioLevelOf(mic.getStats()) }.getOrDefault(0.0)
        }
        out
    }

    /** Highest "audioLevel" in a WebRTC stats report (inbound-rtp / media-source / track). */
    private fun audioLevelOf(statsJson: String): Double {
        var best = 0.0
        fun visit(node: Any?) {
            when (node) {
                is JSONObject -> {
                    if (node.has("audioLevel")) best = maxOf(best, node.optDouble("audioLevel", 0.0))
                    node.keys().forEach { visit(node.opt(it)) }
                }
                is org.json.JSONArray -> for (i in 0 until node.length()) visit(node.opt(i))
            }
        }
        val trimmed = statsJson.trim()
        visit(if (trimmed.startsWith("[")) org.json.JSONArray(trimmed) else JSONObject(trimmed))
        return best
    }

    fun handleRemoteProducer(payload: JSONObject) {
        val currentRoom = roomId ?: return
        if (payload.getString("roomId") != currentRoom) return
        if (payload.getString("fromUserId") == userId) return
        val producerId = payload.getString("producerId")
        if (consumers.containsKey(producerId)) return
        consumeProducer(sfuUrl.trimEnd('/'), currentRoom, producerId, payload.optString("fromUserId"), payload.optString("source"))
    }

    /** The other person stopped some media (e.g. screen share): drop our copy so it doesn't freeze. */
    fun handleRemoteProducerClosed(payload: JSONObject) {
        val currentRoom = roomId ?: return
        if (payload.optString("roomId") != currentRoom) return
        val producerId = payload.optString("producerId")
        var user: String? = null
        var wasScreen = false
        synchronized(lock) {
            val consumer = consumers.remove(producerId) ?: return
            runCatching { consumer.close() }
            user = consumerUsers.remove(producerId)
            wasScreen = screenConsumers.remove(producerId)
        }
        val who = user ?: payload.optString("fromUserId")
        if (wasScreen && who.isNotBlank()) {
            CallVideoTracks.updateScreen(who, null)
            onRemoteScreen(who, false)
        }
    }

    val isSharingScreen get() = screenProducer != null

    /**
     * Share this phone's screen with everyone in the call. [permissionData] is the result Intent of
     * MediaProjectionManager.createScreenCaptureIntent(). A foreground service of type
     * mediaProjection must already be running (Android 10+). Blocking: call off the main thread.
     */
    fun startScreenShare(permissionData: android.content.Intent, onStopped: () -> Unit) {
        val send = sendTransport ?: throw IllegalStateException("Join a call first")
        if (screenProducer != null) return
        val capturer = org.webrtc.ScreenCapturerAndroid(permissionData, object : android.media.projection.MediaProjection.Callback() {
            // The user tapped "Stop sharing" in Android's own notification or status bar chip.
            override fun onStop() = onStopped()
        })
        val helper = SurfaceTextureHelper.create("sfu-screen", WebRtcPeerFactory.egl().eglBaseContext)
        val source = factory.createVideoSource(true)
        capturer.initialize(helper, context, source.capturerObserver)
        val metrics = context.resources.displayMetrics
        // Long side at most 1280 px: sharp enough to read text, light enough for mobile data.
        val scale = minOf(1.0, 1280.0 / maxOf(metrics.widthPixels, metrics.heightPixels))
        val width = (metrics.widthPixels * scale).toInt() / 2 * 2
        val height = (metrics.heightPixels * scale).toInt() / 2 * 2
        capturer.startCapture(width, height, 15)
        val track = factory.createVideoTrack("screen0", source)
        screenCapturer = capturer
        screenHelper = helper
        screenSource = source
        screenTrack = track
        try {
            pendingSource = "screen"
            screenProducer = send.produce({ }, track, null, null, null)
        } catch (e: Exception) {
            releaseScreen()
            throw e
        } finally {
            pendingSource = "microphone"
        }
    }

    /** Stop sharing and tell the server and the others. Blocking (HTTP): call off the main thread. */
    fun stopScreenShare() {
        val producer = screenProducer ?: run { releaseScreen(); return }
        val producerId = producer.id
        screenProducer = null
        runCatching { producer.close() }
        releaseScreen()
        val room = roomId ?: return
        runCatching {
            postJson(
                "${sfuUrl.trimEnd('/')}/v1/rooms/${encode(room)}/producers/$producerId/close",
                JSONObject().put("peerId", userId)
            )
        }
        runCatching {
            sendSignaling(
                "sfu_producer_closed",
                JSONObject()
                    .put("roomId", room)
                    .put("producerId", producerId)
                    .put("kind", "video")
                    .put("source", "screen")
                    .apply {
                        joinOptions.targetUserId?.let { put("toUserId", it) }
                        joinOptions.callId?.let { put("callId", it) }
                    }
            )
        }
    }

    private fun releaseScreen() {
        runCatching { screenCapturer?.stopCapture() }
        screenCapturer?.dispose()
        screenCapturer = null
        screenTrack?.dispose()
        screenTrack = null
        screenSource?.dispose()
        screenSource = null
        screenHelper?.dispose()
        screenHelper = null
    }

    fun muteMicrophone(muted: Boolean) {
        micMuted = muted
        if (muted) micProducer?.pause() else micProducer?.resume()
        audioTrack?.setEnabled(!muted)
    }

    fun muteCamera(muted: Boolean) {
        if (muted) camProducer?.pause() else camProducer?.resume()
        videoTrack?.setEnabled(!muted)
    }

    fun switchCamera() {
        (videoCapturer as? org.webrtc.CameraVideoCapturer)?.switchCamera(null)
        usingFrontCamera = !usingFrontCamera
    }

    fun getLocalVideoTrack(): VideoTrack? = videoTrack

    fun destroy() {
        levelTimer?.cancel()
        levelTimer = null
        synchronized(lock) {
            micProducer?.close()
            micProducer = null
            camProducer?.close()
            camProducer = null
            screenProducer?.close()
            screenProducer = null
            screenConsumers.clear()
            consumers.values.forEach { runCatching { it.close() } }
            consumers.clear()
            consumerUsers.clear()
        }
        CallVideoTracks.clearUsers()
        sendTransport?.close()
        recvTransport?.close()
        sendTransport = null
        recvTransport = null
        device?.dispose()
        device = null
        CallVideoTracks.update(true, null)
        CallVideoTracks.update(false, null)
        releaseScreen()
        runCatching { videoCapturer?.stopCapture() }
        videoCapturer?.dispose()
        videoCapturer = null
        captureHelper?.dispose()
        captureHelper = null
        videoTrack?.dispose()
        videoTrack = null
        videoSource?.dispose()
        videoSource = null
        audioTrack?.dispose()
        audioTrack = null
        audioSource?.dispose()
        audioSource = null
        stopCallAudio()
        // The factory is shared (WebRtcPeerFactory): never dispose it here.
        roomId = null
    }

    private fun createSendTransport(base: String, roomId: String, options: SfuJoinOptions) {
        val info = postJson(
            "$base/v1/rooms/${encode(roomId)}/transports",
            JSONObject().put("peerId", userId)
        )
        val mediasoupDevice = device ?: return
        sendTransport = mediasoupDevice.createSendTransport(
            object : SendTransport.Listener {
                override fun onConnect(transport: Transport, dtlsParameters: String) {
                    postJson(
                        "$base/v1/rooms/${encode(roomId)}/transports/${transport.id}/connect",
                        JSONObject().put("peerId", userId).put("dtlsParameters", JSONObject(dtlsParameters))
                    )
                }

                override fun onConnectionStateChange(transport: Transport, connectionState: String) {}

                override fun onProduce(
                    transport: Transport,
                    kind: String,
                    rtpParameters: String,
                    appData: String
                ): String {
                    val res = postJson(
                        "$base/v1/rooms/${encode(roomId)}/transports/${transport.id}/produce",
                        JSONObject()
                            .put("peerId", userId)
                            .put("kind", kind)
                            .put("rtpParameters", JSONObject(rtpParameters))
                            .put("source", pendingSource)
                    )
                    val producerId = res.getString("producerId")
                    if (options.announceToRoom || options.targetUserId != null) {
                        sendSignaling(
                            "sfu_producer",
                            JSONObject()
                                .put("roomId", roomId)
                                .put("producerId", producerId)
                                .put("kind", kind)
                                .apply {
                                    if (pendingSource != "microphone") put("source", pendingSource)
                                    options.targetUserId?.let { put("toUserId", it) }
                                    options.callId?.let { put("callId", it) }
                                }
                        )
                    }
                    return producerId
                }

                override fun onProduceData(
                    transport: Transport,
                    sctpStreamParameters: String,
                    label: String,
                    protocol: String,
                    appData: String
                ): String = ""
            },
            info.getString("id"),
            info.getJSONObject("iceParameters").toString(),
            info.getJSONArray("iceCandidates").toString(),
            info.getJSONObject("dtlsParameters").toString()
        )
    }

    private fun createRecvTransport(base: String, roomId: String) {
        val info = postJson(
            "$base/v1/rooms/${encode(roomId)}/transports",
            JSONObject().put("peerId", userId)
        )
        val mediasoupDevice = device ?: return
        recvTransport = mediasoupDevice.createRecvTransport(
            object : RecvTransport.Listener {
                override fun onConnect(transport: Transport, dtlsParameters: String) {
                    postJson(
                        "$base/v1/rooms/${encode(roomId)}/transports/${transport.id}/connect",
                        JSONObject().put("peerId", userId).put("dtlsParameters", JSONObject(dtlsParameters))
                    )
                }

                override fun onConnectionStateChange(transport: Transport, connectionState: String) {}
            },
            info.getString("id"),
            info.getJSONObject("iceParameters").toString(),
            info.getJSONArray("iceCandidates").toString(),
            info.getJSONObject("dtlsParameters").toString()
        )
    }

    private fun publishCameraMic(options: SfuJoinOptions) {
        val send = sendTransport ?: return
        if (options.audio) {
            val source = factory.createAudioSource(MediaConstraints())
            audioSource = source
            audioTrack = factory.createAudioTrack("audio0", source)
            pendingSource = "microphone"
            micProducer = send.produce({ }, audioTrack, null, null, null)
        }
        if (options.video) {
            startCamera()
            pendingSource = "camera"
            try {
                videoTrack?.let { camProducer = send.produce({ }, it, null, null, null) }
            } finally {
                pendingSource = "microphone"
            }
        }
    }

    private fun consumeExisting(base: String, roomId: String) {
        val request = Request.Builder()
            .url("$base/v1/rooms/${encode(roomId)}/producers?peerId=${encode(userId)}")
            .header("Authorization", "Bearer $authToken")
            .get()
            .build()
        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return
            val json = JSONObject(response.body?.string() ?: "{}")
            val arr = json.optJSONArray("producers") ?: return
            for (i in 0 until arr.length()) {
                val item = arr.getJSONObject(i)
                consumeProducer(base, roomId, item.getString("producerId"), item.getString("peerId"), item.optString("source"))
            }
        }
    }

    private fun consumeProducer(base: String, roomId: String, producerId: String, fromUserId: String, source: String = "") {
        val recv = recvTransport ?: return
        val mediasoupDevice = device ?: return
        if (consumers.containsKey(producerId)) return

        val res = postJson(
            "$base/v1/rooms/${encode(roomId)}/transports/${recv.id}/consume",
            JSONObject()
                .put("peerId", userId)
                .put("producerId", producerId)
                .put("rtpCapabilities", JSONObject(mediasoupDevice.rtpCapabilities))
        )

        val consumer = recv.consume(
            { synchronized(lock) { consumers.remove(producerId); consumerUsers.remove(producerId); screenConsumers.remove(producerId) } },
            res.getString("consumerId"),
            producerId,
            res.getString("kind"),
            res.getJSONObject("rtpParameters").toString(),
            ""
        )
        val firstForUser = synchronized(lock) {
            val first = fromUserId.isNotBlank() && !consumerUsers.containsValue(fromUserId)
            consumers[producerId] = consumer
            if (fromUserId.isNotBlank()) consumerUsers[producerId] = fromUserId
            if (source == "screen") screenConsumers.add(producerId)
            first
        }
        val track = consumer.track
        if (track is VideoTrack && source == "screen") {
            // Shared screens go to RTCVideoView(screen); cameras stay where they are.
            CallVideoTracks.updateScreen(fromUserId, track)
            onRemoteScreen(fromUserId, true)
        } else if (track is VideoTrack) {
            CallVideoTracks.update(false, track) // newest remote camera shows in RTCVideoView
            if (fromUserId.isNotBlank()) CallVideoTracks.updateUser(fromUserId, track) // RTCVideoView(userId=...)
            onRemoteVideo(track)
        }
        if (firstForUser) onParticipant(fromUserId, true)
    }

    private fun startCamera() {
        val enumerator = Camera2Enumerator(context)
        val deviceName = enumerator.deviceNames.firstOrNull { enumerator.isFrontFacing(it) } ?: return
        videoCapturer = enumerator.createCapturer(deviceName, null)
        val helper = SurfaceTextureHelper.create("sfu-capture", WebRtcPeerFactory.egl().eglBaseContext)
        captureHelper = helper
        val source = factory.createVideoSource(videoCapturer!!.isScreencast)
        videoSource = source
        videoCapturer!!.initialize(helper, context, source.capturerObserver)
        videoCapturer!!.startCapture(640, 480, 24)
        videoTrack = factory.createVideoTrack("video0", source)
        CallVideoTracks.update(true, videoTrack) // self-view in RTCVideoView(local)
    }

    private fun postJson(url: String, body: JSONObject): JSONObject {
        val request = Request.Builder()
            .url(url)
            .header("Authorization", "Bearer $authToken")
            .post(body.toString().toRequestBody("application/json".toMediaType()))
            .build()
        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                // Keep "(code)" for callers that look for it, and add the server's reason (e.g. minutes used up).
                val reason = runCatching { JSONObject(response.body?.string() ?: "").optString("error") }.getOrNull().orEmpty()
                throw IllegalStateException("SFU request failed (${response.code})" + if (reason.isNotBlank()) ": $reason" else "")
            }
            return JSONObject(response.body?.string() ?: "{}")
        }
    }

    private fun encode(value: String) = java.net.URLEncoder.encode(value, Charsets.UTF_8.name())
}

data class SfuJoinOptions(
    val audio: Boolean = true,
    val video: Boolean = false,
    val announceToRoom: Boolean = false,
    val targetUserId: String? = null,
    val callId: String? = null
)
