import Foundation
import WebRTC

public protocol RTCExpressDelegate: AnyObject {
    func rtcExpress(_ rtc: RTCExpress, didConnect userId: String)
    func rtcExpressDidDisconnect(_ rtc: RTCExpress)
    func rtcExpress(_ rtc: RTCExpress, didJoinRoom roomId: String, members: [String])
    func rtcExpress(_ rtc: RTCExpress, didReceive message: RoomMessage)
    func rtcExpress(_ rtc: RTCExpress, didReceive invite: CallInvite)
    func rtcExpress(_ rtc: RTCExpress, callState: CallStateUpdate)
    func rtcExpress(_ rtc: RTCExpress, remoteVideoTrack: RTCVideoTrack)
    func rtcExpress(_ rtc: RTCExpress, didError message: String)
}

public extension RTCExpressDelegate {
    func rtcExpress(_ rtc: RTCExpress, didConnect userId: String) {}
    func rtcExpressDidDisconnect(_ rtc: RTCExpress) {}
    func rtcExpress(_ rtc: RTCExpress, didJoinRoom roomId: String, members: [String]) {}
    func rtcExpress(_ rtc: RTCExpress, didReceive message: RoomMessage) {}
    func rtcExpress(_ rtc: RTCExpress, didReceive invite: CallInvite) {}
    func rtcExpress(_ rtc: RTCExpress, callState: CallStateUpdate) {}
    func rtcExpress(_ rtc: RTCExpress, remoteVideoTrack: RTCVideoTrack) {}
    func rtcExpress(_ rtc: RTCExpress, didError message: String) {}
}

public final class RTCExpress: SignalingListener {
    public weak var delegate: RTCExpressDelegate?

    private let signaling = SignalingClient()
    private var p2p: P2pMediaEngine?

    private var serverUrl = ""
    private var userId = ""
    private var roomId: String?

    private struct ActiveCall {
        let callId: String
        let peerUserId: String
        let roomId: String
        let isCaller: Bool
        let callType: String
    }

    private var activeCall: ActiveCall?

    public init() {
        signaling.listener = self
    }

    public func initClient(_ options: RTCInitOptions) {
        serverUrl = options.serverUrl.trimmingCharacters(in: .init(charactersIn: "/"))
        userId = options.userId
        signaling.connect(serverUrl: serverUrl, token: options.token)
    }

    public func joinRoom(_ roomId: String) {
        self.roomId = roomId
        try? signaling.send(type: "join_room", payload: ["roomId": roomId])
    }

    public func sendMessage(_ text: String) throws {
        guard let roomId else { throw NSError(domain: "RTCExpress", code: 3) }
        try signaling.send(type: "send_message", payload: ["roomId": roomId, "text": text])
    }

    public func callUser(_ peerUserId: String, video: Bool = false) throws {
        guard let roomId else { throw NSError(domain: "RTCExpress", code: 3) }
        let callId = UUID().uuidString
        let callType = video ? "video" : "voice"
        activeCall = ActiveCall(callId: callId, peerUserId: peerUserId, roomId: roomId, isCaller: true, callType: callType)
        ensureP2p(video: video)
        try signaling.send(type: "call_invite", payload: [
            "roomId": roomId,
            "toUserId": peerUserId,
            "callId": callId,
            "callType": callType
        ])
        emitCallState("ringing")
    }

    public func acceptCall() throws {
        guard let call = activeCall else { throw NSError(domain: "RTCExpress", code: 4) }
        try signaling.send(type: "call_accept", payload: callPayload(call))
        ensureP2p(video: call.callType == "video")
        emitCallState("connecting")
    }

    public func rejectCall() throws {
        guard let call = activeCall else { return }
        try signaling.send(type: "call_reject", payload: callPayload(call))
        cleanupCall("rejected")
    }

    public func endCall() throws {
        guard let call = activeCall else { return }
        try signaling.send(type: "call_end", payload: callPayload(call))
        cleanupCall("ended")
    }

    public func muteMicrophone(_ muted: Bool) { p2p?.muteMicrophone(muted) }
    public func muteCamera(_ muted: Bool) { p2p?.muteCamera(muted) }
    public func switchCamera() { p2p?.switchCamera() }

    public func destroy() {
        try? endCall()
        signaling.close()
        p2p?.destroy()
        p2p = nil
    }

    func onConnected(userId: String) { delegate?.rtcExpress(self, didConnect: userId) }
    func onDisconnected() { delegate?.rtcExpressDidDisconnect(self) }
    func onRoomJoined(roomId: String, members: [String]) {
        delegate?.rtcExpress(self, didJoinRoom: roomId, members: members)
    }
    func onMessage(_ message: RoomMessage) { delegate?.rtcExpress(self, didReceive: message) }
    func onCallInvite(_ invite: CallInvite) {
        activeCall = ActiveCall(callId: invite.callId, peerUserId: invite.fromUserId, roomId: invite.roomId, isCaller: false, callType: invite.callType)
        delegate?.rtcExpress(self, didReceive: invite)
        emitCallState("ringing")
    }
    func onCallAccept(_ payload: [String: Any]) {
        guard let call = activeCall else { return }
        ensureP2p(video: call.callType == "video")
        p2p?.createOffer(peerUserId: call.peerUserId, callId: call.callId)
        emitCallState("connecting")
    }
    func onCallReject(_ payload: [String: Any]) { cleanupCall("rejected") }
    func onCallEnd(_ payload: [String: Any]) { cleanupCall("ended") }
    func onWebRtcOffer(_ payload: [String: Any]) {
        ensureP2p(video: activeCall?.callType == "video")
        p2p?.handleOffer(payload)
        emitCallState("connected")
    }
    func onWebRtcAnswer(_ payload: [String: Any]) {
        p2p?.handleAnswer(payload)
        emitCallState("connected")
    }
    func onIceCandidate(_ payload: [String: Any]) { p2p?.handleIceCandidate(payload) }
    func onError(_ message: String) { delegate?.rtcExpress(self, didError: message) }

    private func ensureP2p(video: Bool) {
        if p2p == nil {
            p2p = P2pMediaEngine(
                userId: userId,
                sendSignaling: { [weak self] type, payload in try self?.signaling.send(type: type, payload: payload) },
                activeCall: { [weak self] in
                    guard let call = self?.activeCall else { return nil }
                    return (call.callId, call.peerUserId)
                }
            )
            p2p?.onRemoteVideoTrack = { [weak self] track in
                guard let self else { return }
                self.delegate?.rtcExpress(self, remoteVideoTrack: track)
            }
        }
        p2p?.prepare(video: video)
    }

    private func callPayload(_ call: ActiveCall) -> [String: Any] {
        [
            "callId": call.callId,
            "fromUserId": userId,
            "toUserId": call.peerUserId,
            "roomId": call.roomId,
            "callType": call.callType
        ]
    }

    private func emitCallState(_ state: String) {
        guard let call = activeCall else { return }
        delegate?.rtcExpress(self, callState: CallStateUpdate(
            callId: call.callId,
            state: state,
            peerUserId: call.peerUserId,
            roomId: call.roomId,
            callType: call.callType
        ))
    }

    private func cleanupCall(_ state: String) {
        emitCallState(state)
        p2p?.destroy()
        p2p = nil
        activeCall = nil
    }
}
