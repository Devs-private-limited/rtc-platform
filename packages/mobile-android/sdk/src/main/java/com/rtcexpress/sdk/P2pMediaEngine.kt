package com.rtcexpress.sdk

import android.content.Context
import org.json.JSONObject
import org.webrtc.AudioSource
import org.webrtc.AudioTrack
import org.webrtc.Camera2Enumerator
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoCapturer
import org.webrtc.VideoSource
import org.webrtc.VideoTrack

class P2pMediaEngine(
    private val context: Context,
    private val userId: String,
    private val sendSignaling: (String, JSONObject) -> Unit,
    private val activeCall: () -> Pair<String, String>?
) {
    private val eglBase = EglBase.create()
    private val factory: PeerConnectionFactory
    private var peerConnection: PeerConnection? = null
    private var audioSource: AudioSource? = null
    private var audioTrack: AudioTrack? = null
    private var videoSource: VideoSource? = null
    private var videoTrack: VideoTrack? = null
    private var videoCapturer: VideoCapturer? = null
    private var video = false
    private var usingFrontCamera = true

    var onRemoteVideoTrack: ((VideoTrack) -> Unit)? = null

    init {
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(context)
                .createInitializationOptions()
        )
        factory = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(eglBase.eglBaseContext, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(eglBase.eglBaseContext))
            .createPeerConnectionFactory()
    }

    fun prepare(enableVideo: Boolean) {
        video = enableVideo
        if (peerConnection != null) return

        val iceServers = listOf(
            PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer()
        )
        peerConnection = factory.createPeerConnection(
            iceServers,
            object : PeerConnection.Observer {
                override fun onIceCandidate(candidate: IceCandidate) {
                    val call = activeCall() ?: return
                    val payload = JSONObject()
                        .put("callId", call.first)
                        .put("fromUserId", userId)
                        .put("toUserId", call.second)
                        .put(
                            "candidate",
                            JSONObject()
                                .put("candidate", candidate.sdp)
                                .put("sdpMid", candidate.sdpMid)
                                .put("sdpMLineIndex", candidate.sdpMLineIndex)
                        )
                    sendSignaling("ice_candidate", payload)
                }

                override fun onAddTrack(receiver: org.webrtc.RtpReceiver?, streams: Array<out org.webrtc.MediaStream>?) {
                    val track = receiver?.track()
                    if (track is VideoTrack) onRemoteVideoTrack?.invoke(track)
                }

                override fun onSignalingChange(state: PeerConnection.SignalingState?) {}
                override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) {}
                override fun onIceConnectionReceivingChange(receiving: Boolean) {}
                override fun onIceGatheringChange(state: PeerConnection.IceGatheringState?) {}
                override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) {}
                override fun onAddStream(stream: org.webrtc.MediaStream?) {}
                override fun onRemoveStream(stream: org.webrtc.MediaStream?) {}
                override fun onDataChannel(channel: org.webrtc.DataChannel?) {}
                override fun onRenegotiationNeeded() {}
                override fun onRemoveTrack(receiver: org.webrtc.RtpReceiver?) {}
            }
        )

        val audioConstraints = MediaConstraints()
        audioSource = factory.createAudioSource(audioConstraints)
        audioTrack = factory.createAudioTrack("audio0", audioSource)
        peerConnection?.addTrack(audioTrack)

        if (enableVideo) {
            startCamera()
            videoTrack?.let { peerConnection?.addTrack(it) }
        }
    }

    fun createOffer(peerUserId: String, callId: String) {
        prepare(video)
        peerConnection?.createOffer(object : SimpleSdpObserver("offer") {
            override fun onCreateSuccess(description: SessionDescription) {
                peerConnection?.setLocalDescription(SimpleSdpObserver("local-offer"), description)
                val payload = JSONObject()
                    .put("callId", callId)
                    .put("fromUserId", userId)
                    .put("toUserId", peerUserId)
                    .put("sdp", JSONObject().put("type", description.type.canonicalForm()).put("sdp", description.description))
                sendSignaling("webrtc_offer", payload)
            }
        }, MediaConstraints())
    }

    fun handleOffer(payload: JSONObject) {
        prepare(video)
        val sdp = payload.getJSONObject("sdp")
        val remote = SessionDescription(SessionDescription.Type.OFFER, sdp.getString("sdp"))
        peerConnection?.setRemoteDescription(SimpleSdpObserver("remote-offer"), remote)
        peerConnection?.createAnswer(object : SimpleSdpObserver("answer") {
            override fun onCreateSuccess(description: SessionDescription) {
                peerConnection?.setLocalDescription(SimpleSdpObserver("local-answer"), description)
                val answer = JSONObject()
                    .put("callId", payload.getString("callId"))
                    .put("fromUserId", userId)
                    .put("toUserId", payload.getString("fromUserId"))
                    .put("sdp", JSONObject().put("type", description.type.canonicalForm()).put("sdp", description.description))
                sendSignaling("webrtc_answer", answer)
            }
        }, MediaConstraints())
    }

    fun handleAnswer(payload: JSONObject) {
        val sdp = payload.getJSONObject("sdp")
        val remote = SessionDescription(SessionDescription.Type.ANSWER, sdp.getString("sdp"))
        peerConnection?.setRemoteDescription(SimpleSdpObserver("remote-answer"), remote)
    }

    fun handleIceCandidate(payload: JSONObject) {
        val candidate = payload.getJSONObject("candidate")
        val ice = IceCandidate(
            candidate.optString("sdpMid"),
            candidate.optInt("sdpMLineIndex"),
            candidate.getString("candidate")
        )
        peerConnection?.addIceCandidate(ice)
    }

    fun attachLocalVideo(renderer: SurfaceViewRenderer) {
        renderer.init(eglBase.eglBaseContext, null)
        renderer.setMirror(usingFrontCamera)
        videoTrack?.addSink(renderer)
    }

    fun attachRemoteVideo(track: VideoTrack, renderer: SurfaceViewRenderer) {
        renderer.init(eglBase.eglBaseContext, null)
        track.addSink(renderer)
    }

    fun switchCamera() {
        if (!video) return
        (videoCapturer as? org.webrtc.CameraVideoCapturer)?.switchCamera(null)
        usingFrontCamera = !usingFrontCamera
    }

    fun muteMicrophone(muted: Boolean) {
        audioTrack?.setEnabled(!muted)
    }

    fun muteCamera(muted: Boolean) {
        videoTrack?.setEnabled(!muted)
    }

    fun destroy() {
        videoCapturer?.stopCapture()
        videoCapturer?.dispose()
        videoTrack?.dispose()
        videoSource?.dispose()
        audioTrack?.dispose()
        audioSource?.dispose()
        peerConnection?.close()
        peerConnection = null
        factory.dispose()
        eglBase.release()
    }

    private fun startCamera() {
        val enumerator = Camera2Enumerator(context)
        val device = enumerator.deviceNames.firstOrNull { enumerator.isFrontFacing(it) } ?: return
        videoCapturer = enumerator.createCapturer(device, null)
        val helper = SurfaceTextureHelper.create("capture", eglBase.eglBaseContext)
        videoSource = factory.createVideoSource(videoCapturer!!.isScreencast)
        videoCapturer!!.initialize(helper, context, videoSource!!.capturerObserver)
        videoCapturer!!.startCapture(640, 480, 24)
        videoTrack = factory.createVideoTrack("video0", videoSource)
    }

    private open class SimpleSdpObserver(private val label: String) : org.webrtc.SdpObserver {
        override fun onCreateSuccess(description: SessionDescription) {}
        override fun onSetSuccess() {}
        override fun onCreateFailure(error: String) {}
        override fun onSetFailure(error: String) {}
    }
}
