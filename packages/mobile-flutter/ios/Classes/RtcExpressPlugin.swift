import Flutter
import UIKit

public class RtcExpressPlugin: NSObject, FlutterPlugin, FlutterStreamHandler, RTCExpressDelegate {
    private var rtc: RTCExpress?
    private var eventSink: FlutterEventSink?

    public static func register(with registrar: FlutterPluginRegistrar) {
        let channel = FlutterMethodChannel(name: "rtcexpress", binaryMessenger: registrar.messenger())
        let instance = RtcExpressPlugin()
        registrar.addMethodCallDelegate(instance, channel: channel)
        let events = FlutterEventChannel(name: "rtcexpress/events", binaryMessenger: registrar.messenger())
        events.setStreamHandler(instance)
    }

    private func emit(_ event: String, _ data: [String: Any]) {
        eventSink?(["event": event, "data": data])
    }

    public func onListen(withArguments arguments: Any?, eventSink events: @escaping FlutterEventSink) -> FlutterError? {
        eventSink = events
        return nil
    }

    public func onCancel(withArguments arguments: Any?) -> FlutterError? {
        eventSink = nil
        return nil
    }

    public func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
        switch call.method {
        case "fetchToken":
            guard let args = call.arguments as? [String: Any],
                  let serverUrl = args["serverUrl"] as? String,
                  let req = args["request"] as? [String: Any] else {
                result(FlutterError(code: "bad_args", message: "Invalid arguments", details: nil))
                return
            }
            Task {
                do {
                    let tokenRequest = TokenRequest(
                        appId: req["appId"] as? String ?? "",
                        appSecret: req["appSecret"] as? String ?? "",
                        userId: req["userId"] as? String ?? "",
                        roomId: req["roomId"] as? String
                    )
                    let response = try await TokenClient.fetchToken(serverUrl: serverUrl, request: tokenRequest)
                    result(["token": response.token, "expiresIn": response.expiresIn])
                } catch {
                    result(FlutterError(code: "token_error", message: error.localizedDescription, details: nil))
                }
            }
        case "init":
            guard let opts = call.arguments as? [String: Any] else {
                result(FlutterError(code: "bad_args", message: "Invalid init options", details: nil))
                return
            }
            let express = RTCExpress()
            express.delegate = self
            express.initClient(RTCInitOptions(
                serverUrl: opts["serverUrl"] as? String ?? "",
                appId: opts["appId"] as? String ?? "",
                userId: opts["userId"] as? String ?? "",
                token: opts["token"] as? String ?? "",
                mediaMode: opts["mediaMode"] as? String ?? "auto"
            ))
            rtc = express
            result(nil)
        case "joinRoom":
            if let args = call.arguments as? [String: Any], let roomId = args["roomId"] as? String {
                rtc?.joinRoom(roomId)
            }
            result(nil)
        case "sendMessage":
            if let args = call.arguments as? [String: Any], let text = args["text"] as? String {
                try? rtc?.sendMessage(text)
            }
            result(nil)
        case "callUser":
            if let args = call.arguments as? [String: Any],
               let peer = args["peerUserId"] as? String {
                try? rtc?.callUser(peer, video: args["video"] as? Bool ?? false)
            }
            result(nil)
        case "acceptCall": try? rtc?.acceptCall(); result(nil)
        case "rejectCall": rtc?.rejectCall(); result(nil)
        case "endCall": rtc?.endCall(); result(nil)
        case "muteMicrophone":
            rtc?.muteMicrophone((call.arguments as? [String: Any])?["muted"] as? Bool ?? false)
            result(nil)
        case "muteCamera":
            rtc?.muteCamera((call.arguments as? [String: Any])?["muted"] as? Bool ?? false)
            result(nil)
        case "switchCamera": rtc?.switchCamera(); result(nil)
        case "destroy": rtc = nil; result(nil)
        default:
            result(FlutterMethodNotImplemented)
        }
    }

    public func rtcExpress(_ rtc: RTCExpress, didConnect userId: String) {
        emit("connected", ["userId": userId])
    }

    public func rtcExpressDidDisconnect(_ rtc: RTCExpress) {
        emit("disconnected", [:])
    }

    public func rtcExpress(_ rtc: RTCExpress, didJoinRoom roomId: String, members: [String]) {
        emit("roomJoined", ["roomId": roomId, "members": members])
    }

    public func rtcExpress(_ rtc: RTCExpress, didReceive message: RoomMessage) {
        emit("message", [
            "roomId": message.roomId,
            "fromUserId": message.fromUserId,
            "text": message.text,
            "sentAt": message.sentAt
        ])
    }

    public func rtcExpress(_ rtc: RTCExpress, didReceive invite: CallInvite) {
        emit("callInvite", [
            "callId": invite.callId,
            "roomId": invite.roomId,
            "fromUserId": invite.fromUserId,
            "callType": invite.callType
        ])
    }

    public func rtcExpress(_ rtc: RTCExpress, callState: CallStateUpdate) {
        emit("callState", [
            "callId": callState.callId,
            "state": callState.state,
            "peerUserId": callState.peerUserId,
            "roomId": callState.roomId,
            "callType": callState.callType
        ])
    }

    public func rtcExpress(_ rtc: RTCExpress, remoteVideoTrack: RTCVideoTrack) {
        emit("remoteVideo", ["trackId": remoteVideoTrack.trackId])
    }

    public func rtcExpress(_ rtc: RTCExpress, didError message: String) {
        emit("error", ["message": message])
    }
}
