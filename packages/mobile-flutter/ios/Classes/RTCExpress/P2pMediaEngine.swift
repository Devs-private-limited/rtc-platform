import Foundation
import WebRTC

final class P2pMediaEngine: NSObject {
    private let userId: String
    private let sendSignaling: (String, [String: Any]) throws -> Void
    private let activeCall: () -> (callId: String, peerUserId: String)?

    private var factory: RTCPeerConnectionFactory?
    private var peerConnection: RTCPeerConnection?
    private var audioTrack: RTCAudioTrack?
    private var videoTrack: RTCVideoTrack?
    private var capturer: RTCCameraVideoCapturer?
    private var videoEnabled = false
    private var usingFrontCamera = true

    var onRemoteVideoTrack: ((RTCVideoTrack) -> Void)?

    init(
        userId: String,
        sendSignaling: @escaping (String, [String: Any]) throws -> Void,
        activeCall: @escaping () -> (callId: String, peerUserId: String)?
    ) {
        self.userId = userId
        self.sendSignaling = sendSignaling
        self.activeCall = activeCall
        super.init()
        RTCInitializeSSL()
        let encoder = RTCDefaultVideoEncoderFactory()
        let decoder = RTCDefaultVideoDecoderFactory()
        factory = RTCPeerConnectionFactory(encoderFactory: encoder, decoderFactory: decoder)
    }

    func prepare(video: Bool) {
        videoEnabled = video
        guard peerConnection == nil, let factory else { return }

        let config = RTCConfiguration()
        config.iceServers = [RTCIceServer(urlStrings: ["stun:stun.l.google.com:19302"])]
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        peerConnection = factory.peerConnection(with: config, constraints: constraints, delegate: self)

        let audioSource = factory.audioSource(with: constraints)
        audioTrack = factory.audioTrack(with: audioSource, trackId: "audio0")
        peerConnection?.add(audioTrack!, streamIds: ["stream0"])

        if video {
            startCamera(factory: factory)
            if let videoTrack {
                peerConnection?.add(videoTrack, streamIds: ["stream0"])
            }
        }
    }

    func createOffer(peerUserId: String, callId: String) {
        prepare(video: videoEnabled)
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        peerConnection?.offer(for: constraints) { [weak self] sdp, _ in
            guard let self, let sdp else { return }
            self.peerConnection?.setLocalDescription(sdp)
            let payload: [String: Any] = [
                "callId": callId,
                "fromUserId": self.userId,
                "toUserId": peerUserId,
                "sdp": ["type": sdp.type.rawValue, "sdp": sdp.sdp]
            ]
            try? self.sendSignaling("webrtc_offer", payload)
        }
    }

    func handleOffer(_ payload: [String: Any]) {
        prepare(video: videoEnabled)
        guard let sdpObj = payload["sdp"] as? [String: Any],
              let sdpText = sdpObj["sdp"] as? String,
              let type = sdpObj["type"] as? String else { return }
        let remote = RTCSessionDescription(type: RTCSdpType(rawValue: type) ?? .offer, sdp: sdpText)
        peerConnection?.setRemoteDescription(remote) { [weak self] _ in
            guard let self else { return }
            let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
            self.peerConnection?.answer(for: constraints) { answer, _ in
                guard let answer else { return }
                self.peerConnection?.setLocalDescription(answer)
                let response: [String: Any] = [
                    "callId": payload["callId"] as? String ?? "",
                    "fromUserId": self.userId,
                    "toUserId": payload["fromUserId"] as? String ?? "",
                    "sdp": ["type": answer.type.rawValue, "sdp": answer.sdp]
                ]
                try? self.sendSignaling("webrtc_answer", response)
            }
        }
    }

    func handleAnswer(_ payload: [String: Any]) {
        guard let sdpObj = payload["sdp"] as? [String: Any],
              let sdpText = sdpObj["sdp"] as? String,
              let type = sdpObj["type"] as? String else { return }
        let remote = RTCSessionDescription(type: RTCSdpType(rawValue: type) ?? .answer, sdp: sdpText)
        peerConnection?.setRemoteDescription(remote)
    }

    func handleIceCandidate(_ payload: [String: Any]) {
        guard let candidateObj = payload["candidate"] as? [String: Any],
              let candidate = candidateObj["candidate"] as? String else { return }
        let ice = RTCIceCandidate(
            sdp: candidate,
            sdpMLineIndex: Int32(candidateObj["sdpMLineIndex"] as? Int ?? 0),
            sdpMid: candidateObj["sdpMid"] as? String
        )
        peerConnection?.add(ice)
    }

    func attachLocalVideo(to renderer: RTCVideoRenderer) {
        videoTrack?.add(renderer)
    }

    func attachRemoteVideo(_ track: RTCVideoTrack, to renderer: RTCVideoRenderer) {
        track.add(renderer)
    }

    func switchCamera() {
        guard let capturer else { return }
        usingFrontCamera.toggle()
        if let device = RTCCameraVideoCapturer.captureDevices().first(where: {
            $0.position == (usingFrontCamera ? .front : .back)
        }) {
            capturer.startCapture(with: device, format: RTCCameraVideoCapturer.supportedFormats(for: device).last!, fps: 24)
        }
    }

    func muteMicrophone(_ muted: Bool) {
        audioTrack?.isEnabled = !muted
    }

    func muteCamera(_ muted: Bool) {
        videoTrack?.isEnabled = !muted
    }

    func destroy() {
        capturer?.stopCapture()
        peerConnection?.close()
        peerConnection = nil
        factory = nil
        RTCCleanupSSL()
    }

    private func startCamera(factory: RTCPeerConnectionFactory) {
        let source = factory.videoSource()
        capturer = RTCCameraVideoCapturer(delegate: source)
        videoTrack = factory.videoTrack(with: source, trackId: "video0")
        if let device = RTCCameraVideoCapturer.captureDevices().first(where: { $0.position == .front }),
           let format = RTCCameraVideoCapturer.supportedFormats(for: device).last {
            capturer?.startCapture(with: device, format: format, fps: 24)
        }
    }
}

extension P2pMediaEngine: RTCPeerConnectionDelegate {
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {
        if let track = stream.videoTracks.first {
            onRemoteVideoTrack?(track)
        }
    }
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
        guard let call = activeCall() else { return }
        let payload: [String: Any] = [
            "callId": call.callId,
            "fromUserId": userId,
            "toUserId": call.peerUserId,
            "candidate": [
                "candidate": candidate.sdp,
                "sdpMid": candidate.sdpMid ?? "",
                "sdpMLineIndex": candidate.sdpMLineIndex
            ]
        ]
        try? sendSignaling("ice_candidate", payload)
    }
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}
}
