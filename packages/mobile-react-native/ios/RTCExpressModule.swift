import Foundation
import React

@objc(RTCExpress)
class RTCExpressModule: RCTEventEmitter, RTCExpressDelegate {
    private var rtc: RTCExpress?

    override static func requiresMainQueueSetup() -> Bool { true }

    override func supportedEvents() -> [String]! {
        ["connected", "disconnected", "roomJoined", "message", "callInvite", "callState", "remoteVideo", "error"]
    }

    @objc(fetchToken:request:resolver:rejecter:)
    func fetchToken(
        _ serverUrl: String,
        request: NSDictionary,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        Task {
            do {
                let tokenRequest = TokenRequest(
                    appId: request["appId"] as? String ?? "",
                    appSecret: request["appSecret"] as? String ?? "",
                    userId: request["userId"] as? String ?? "",
                    roomId: request["roomId"] as? String
                )
                let response = try await TokenClient.fetchToken(serverUrl: serverUrl, request: tokenRequest)
                resolve(["token": response.token, "expiresIn": response.expiresIn])
            } catch {
                reject("token_error", error.localizedDescription, error)
            }
        }
    }

    @objc(init:resolver:rejecter:)
    func initialize(
        _ options: NSDictionary,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        let express = RTCExpress()
        express.delegate = self
        express.initClient(
            RTCInitOptions(
                serverUrl: options["serverUrl"] as? String ?? "",
                appId: options["appId"] as? String ?? "",
                userId: options["userId"] as? String ?? "",
                token: options["token"] as? String ?? "",
                mediaMode: options["mediaMode"] as? String ?? "auto"
            )
        )
        rtc = express
        resolve(nil)
    }

    @objc func joinRoom(_ roomId: String) { rtc?.joinRoom(roomId) }
    @objc func sendMessage(_ text: String) { try? rtc?.sendMessage(text) }
    @objc func callUser(_ peerUserId: String, video: Bool) { rtc?.callUser(peerUserId, video: video) }
    @objc func acceptCall() { try? rtc?.acceptCall() }
    @objc func rejectCall() { rtc?.rejectCall() }
    @objc func endCall() { rtc?.endCall() }
    @objc func muteMicrophone(_ muted: Bool) { rtc?.muteMicrophone(muted) }
    @objc func muteCamera(_ muted: Bool) { rtc?.muteCamera(muted) }
    @objc func switchCamera() { rtc?.switchCamera() }
    @objc func destroy() { rtc = nil }

    func rtcExpress(_ rtc: RTCExpress, didConnect userId: String) {
        sendEvent(withName: "connected", body: ["userId": userId])
    }

    func rtcExpressDidDisconnect(_ rtc: RTCExpress) {
        sendEvent(withName: "disconnected", body: nil)
    }

    func rtcExpress(_ rtc: RTCExpress, didJoinRoom roomId: String, members: [String]) {
        sendEvent(withName: "roomJoined", body: ["roomId": roomId, "members": members])
    }

    func rtcExpress(_ rtc: RTCExpress, didReceive message: RoomMessage) {
        sendEvent(withName: "message", body: [
            "roomId": message.roomId,
            "fromUserId": message.fromUserId,
            "text": message.text,
            "sentAt": message.sentAt
        ])
    }

    func rtcExpress(_ rtc: RTCExpress, didReceive invite: CallInvite) {
        sendEvent(withName: "callInvite", body: [
            "callId": invite.callId,
            "roomId": invite.roomId,
            "fromUserId": invite.fromUserId,
            "callType": invite.callType
        ])
    }

    func rtcExpress(_ rtc: RTCExpress, callState: CallStateUpdate) {
        sendEvent(withName: "callState", body: [
            "callId": callState.callId,
            "state": callState.state,
            "peerUserId": callState.peerUserId,
            "roomId": callState.roomId,
            "callType": callState.callType
        ])
    }

    func rtcExpress(_ rtc: RTCExpress, remoteVideoTrack: RTCVideoTrack) {
        sendEvent(withName: "remoteVideo", body: ["trackId": remoteVideoTrack.trackId])
    }

    func rtcExpress(_ rtc: RTCExpress, didError message: String) {
        sendEvent(withName: "error", body: ["message": message])
    }
}
