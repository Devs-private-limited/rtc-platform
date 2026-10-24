import Foundation

public struct RTCInitOptions {
    public let serverUrl: String
    public let appId: String
    public let userId: String
    public let token: String
    public let mediaMode: String

    public init(serverUrl: String, appId: String, userId: String, token: String, mediaMode: String = "p2p") {
        self.serverUrl = serverUrl
        self.appId = appId
        self.userId = userId
        self.token = token
        self.mediaMode = mediaMode
    }
}

public struct TokenRequest: Codable {
    public let appId: String
    public let appSecret: String
    public let userId: String
    public let roomId: String?

    public init(appId: String, appSecret: String, userId: String, roomId: String? = nil) {
        self.appId = appId
        self.appSecret = appSecret
        self.userId = userId
        self.roomId = roomId
    }
}

public struct TokenResponse: Codable {
    public let token: String
    public let expiresIn: Int
}

public struct RoomMessage {
    public let roomId: String
    public let fromUserId: String
    public let text: String
    public let sentAt: Int64
}

public struct CallInvite {
    public let callId: String
    public let roomId: String
    public let fromUserId: String
    public let toUserId: String
    public let callType: String
}

public struct CallStateUpdate {
    public let callId: String
    public let state: String
    public let peerUserId: String
    public let roomId: String
    public let callType: String
}

enum JsonCodec {
    static func clientMessage(type: String, payload: [String: Any]) throws -> String {
        let root: [String: Any] = ["type": type, "payload": payload]
        let data = try JSONSerialization.data(withJSONObject: root)
        return String(data: data, encoding: .utf8) ?? "{}"
    }
}
