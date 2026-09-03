import Foundation

protocol SignalingListener: AnyObject {
    func onConnected(userId: String)
    func onDisconnected()
    func onRoomJoined(roomId: String, members: [String])
    func onMessage(_ message: RoomMessage)
    func onCallInvite(_ invite: CallInvite)
    func onCallAccept(_ payload: [String: Any])
    func onCallReject(_ payload: [String: Any])
    func onCallEnd(_ payload: [String: Any])
    func onWebRtcOffer(_ payload: [String: Any])
    func onWebRtcAnswer(_ payload: [String: Any])
    func onIceCandidate(_ payload: [String: Any])
    func onError(_ message: String)
}

final class SignalingClient {
    weak var listener: SignalingListener?
    private var task: URLSessionWebSocketTask?
    private let session = URLSession(configuration: .default)

    func connect(serverUrl: String, token: String) {
        let wsBase = serverUrl
            .trimmingCharacters(in: .init(charactersIn: "/"))
            .replacingOccurrences(of: "https://", with: "wss://")
            .replacingOccurrences(of: "http://", with: "ws://")
        let encoded = token.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? token
        let url = URL(string: "\(wsBase)/ws?token=\(encoded)")!
        task = session.webSocketTask(with: url)
        task?.resume()
        listen()
    }

    func send(type: String, payload: [String: Any]) throws {
        guard let task else { throw NSError(domain: "RTCExpress", code: 2) }
        let text = try JsonCodec.clientMessage(type: type, payload: payload)
        task.send(.string(text)) { _ in }
    }

    func close() {
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
    }

    private func listen() {
        task?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure:
                self.listener?.onDisconnected()
            case .success(let message):
                if case .string(let text) = message,
                   let data = text.data(using: .utf8),
                   let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                    self.handle(json)
                }
                self.listen()
            }
        }
    }

    private func handle(_ message: [String: Any]) {
        guard let type = message["type"] as? String else { return }
        let payload = message["payload"] as? [String: Any] ?? [:]
        switch type {
        case "connected":
            listener?.onConnected(userId: payload["userId"] as? String ?? "")
        case "room_joined":
            listener?.onRoomJoined(
                roomId: payload["roomId"] as? String ?? "",
                members: payload["members"] as? [String] ?? []
            )
        case "message":
            listener?.onMessage(RoomMessage(
                roomId: payload["roomId"] as? String ?? "",
                fromUserId: payload["fromUserId"] as? String ?? "",
                text: payload["text"] as? String ?? "",
                sentAt: payload["sentAt"] as? Int64 ?? 0
            ))
        case "call_invite":
            listener?.onCallInvite(CallInvite(
                callId: payload["callId"] as? String ?? "",
                roomId: payload["roomId"] as? String ?? "",
                fromUserId: payload["fromUserId"] as? String ?? "",
                toUserId: payload["toUserId"] as? String ?? "",
                callType: payload["callType"] as? String ?? "voice"
            ))
        case "call_accept": listener?.onCallAccept(payload)
        case "call_reject": listener?.onCallReject(payload)
        case "call_end": listener?.onCallEnd(payload)
        case "webrtc_offer": listener?.onWebRtcOffer(payload)
        case "webrtc_answer": listener?.onWebRtcAnswer(payload)
        case "ice_candidate": listener?.onIceCandidate(payload)
        case "error":
            listener?.onError(payload["message"] as? String ?? "Unknown error")
        default: break
        }
    }
}
