import Foundation

public enum TokenClient {
    public static func fetchToken(serverUrl: String, request: TokenRequest) async throws -> TokenResponse {
        let url = URL(string: "\(serverUrl.trimmingCharacters(in: .init(charactersIn: "/")))/v1/token")!
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.httpBody = try JSONEncoder().encode(request)

        let (data, response) = try await URLSession.shared.data(for: urlRequest)
        guard let http = response as? HTTPURLResponse, http.statusCode < 300 else {
            let err = (try? JSONDecoder().decode([String: String].self, from: data))?["error"]
            throw NSError(domain: "RTCExpress", code: 1, userInfo: [NSLocalizedDescriptionKey: err ?? "Token request failed"])
        }
        return try JSONDecoder().decode(TokenResponse.self, from: data)
    }
}
