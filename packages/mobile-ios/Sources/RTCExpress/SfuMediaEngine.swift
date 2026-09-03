import Foundation
import WebRTC

/// iOS SFU media requires [mediasoup-client-swift](https://github.com/VLprojects/mediasoup-client-swift).
/// REST join validates SFU auth; see docs/MOBILE-SFU.md to enable full group voice/video.
final class SfuMediaEngine {
    private let sfuUrl: String
    private let userId: String
    private let authToken: String
    private let sendSignaling: (String, [String: Any]) throws -> Void

    init(
        sfuUrl: String,
        userId: String,
        authToken: String,
        sendSignaling: @escaping (String, [String: Any]) throws -> Void
    ) {
        self.sfuUrl = sfuUrl
        self.userId = userId
        self.authToken = authToken
        self.sendSignaling = sendSignaling
    }

    func joinRoom(roomId: String, options: SfuJoinOptions) async throws {
        let base = sfuUrl.trimmingCharacters(in: .init(charactersIn: "/"))
        let encodedRoom = roomId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? roomId
        _ = try await postJSON("\(base)/v1/rooms/\(encodedRoom)/join", body: ["peerId": userId])
        throw NSError(
            domain: "RTCExpress",
            code: 30,
            userInfo: [NSLocalizedDescriptionKey: "iOS SFU media requires mediasoup-client-swift. See docs/MOBILE-SFU.md"]
        )
    }

    func handleRemoteProducer(_ payload: [String: Any]) {}

    func destroy() {}

    private func postJSON(_ urlString: String, body: [String: Any]) async throws -> [String: Any] {
        var request = URLRequest(url: URL(string: urlString)!)
        request.httpMethod = "POST"
        request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode < 300 else {
            throw NSError(domain: "RTCExpress", code: 31, userInfo: [NSLocalizedDescriptionKey: "SFU request failed"])
        }
        return (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }
}

struct SfuJoinOptions {
    var audio = true
    var video = false
    var announceToRoom = false
    var targetUserId: String?
    var callId: String?
}
