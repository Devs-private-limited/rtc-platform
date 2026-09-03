import Foundation

public struct PlatformConfig {
    public let sfuUrl: String?
    public let voiceSfu: Bool
    public let videoSfu: Bool
}

public struct StoredMessage {
    public let id: String
    public let roomId: String
    public let fromUserId: String
    public let text: String
    public let clientMsgId: String?
    public let sentAt: String
}

public struct MessageHistoryPage {
    public let messages: [StoredMessage]
    public let nextCursor: String?
}

public enum PlatformApi {
    public static func fetchPlatformConfig(serverUrl: String, appId: String? = nil) async throws -> PlatformConfig {
        var urlString = "\(serverUrl.trimmingCharacters(in: .init(charactersIn: "/")))/v1/config"
        if let appId, !appId.isEmpty {
            urlString += "?appId=\(appId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? appId)"
        }
        let (data, response) = try await URLSession.shared.data(from: URL(string: urlString)!)
        guard let http = response as? HTTPURLResponse, http.statusCode < 300 else {
            throw NSError(domain: "RTCExpress", code: 10, userInfo: [NSLocalizedDescriptionKey: "Failed to fetch platform config"])
        }
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        let features = json["features"] as? [String: Any]
        return PlatformConfig(
            sfuUrl: (json["sfuUrl"] as? String).flatMap { $0.isEmpty ? nil : $0 },
            voiceSfu: features?["voiceSfu"] as? Bool ?? false,
            videoSfu: features?["videoSfu"] as? Bool ?? false
        )
    }

    public static func getMessageHistory(
        serverUrl: String,
        token: String,
        roomId: String,
        before: String? = nil,
        limit: Int = 50
    ) async throws -> MessageHistoryPage {
        var components = URLComponents(string: "\(serverUrl.trimmingCharacters(in: .init(charactersIn: "/")))/v1/rooms/\(roomId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? roomId)/messages")!
        var query = [URLQueryItem(name: "limit", value: String(limit))]
        if let before { query.append(URLQueryItem(name: "before", value: before)) }
        components.queryItems = query
        var request = URLRequest(url: components.url!)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode < 300 else {
            let err = (try? JSONSerialization.jsonObject(with: data) as? [String: String])?["error"]
            throw NSError(domain: "RTCExpress", code: 11, userInfo: [NSLocalizedDescriptionKey: err ?? "Failed to load history"])
        }
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        let rawMessages = json["messages"] as? [[String: Any]] ?? []
        let messages = rawMessages.map {
            StoredMessage(
                id: $0["id"] as? String ?? "",
                roomId: $0["roomId"] as? String ?? "",
                fromUserId: $0["fromUserId"] as? String ?? "",
                text: $0["text"] as? String ?? "",
                clientMsgId: $0["clientMsgId"] as? String,
                sentAt: $0["sentAt"] as? String ?? ""
            )
        }
        let next = json["nextCursor"] as? String
        return MessageHistoryPage(messages: messages, nextCursor: next?.isEmpty == true ? nil : next)
    }
}

public struct IncomingCallDisplay {
    public let title: String
    public let body: String
    public let callId: String
    public let roomId: String
    public let fromUserId: String
    public let callType: String

    public static func from(_ invite: CallInvite) -> IncomingCallDisplay {
        let label = invite.callType == "video" ? "Video call" : "Voice call"
        return IncomingCallDisplay(
            title: label,
            body: "Incoming call from \(invite.fromUserId)",
            callId: invite.callId,
            roomId: invite.roomId,
            fromUserId: invite.fromUserId,
            callType: invite.callType
        )
    }
}

public protocol IncomingCallNotifier: AnyObject {
    func onIncomingCall(_ invite: CallInvite, display: IncomingCallDisplay)
}

public struct RecordingResult {
    public let fileURL: URL
    public let durationMs: Int64
    public let mimeType: String
    public let sizeBytes: Int64
}
