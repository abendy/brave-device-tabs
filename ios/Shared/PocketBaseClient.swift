import Foundation

enum PocketBaseError: Error, LocalizedError {
    case notConfigured
    case invalidResponse
    case server(String)

    var errorDescription: String? {
        switch self {
        case .notConfigured: return "Set a server URL and sign in first."
        case .invalidResponse: return "The server returned an unexpected response."
        case .server(let message): return message
        }
    }
}

enum PocketBaseClient {
    static func login(serverURL: URL, email: String, password: String) async throws -> String {
        var request = URLRequest(url: serverURL.appendingPathComponent("api/collections/users/auth-with-password"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["identity": email, "password": password])

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw PocketBaseError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            throw PocketBaseError.server(errorMessage(from: data) ?? "Sign-in failed (\(http.statusCode)).")
        }

        struct AuthResponse: Decodable { let token: String }
        return try JSONDecoder().decode(AuthResponse.self, from: data).token
    }

    static func shareLink(url: String, title: String?, source: String) async throws {
        guard let serverURL = SharedStore.serverURL, let token = SharedStore.authToken else {
            throw PocketBaseError.notConfigured
        }

        var request = URLRequest(url: serverURL.appendingPathComponent("api/collections/shared_links/records"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(token, forHTTPHeaderField: "Authorization")

        var body: [String: String] = ["url": url, "source": source]
        if let title, !title.isEmpty { body["title"] = title }
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw PocketBaseError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            throw PocketBaseError.server(errorMessage(from: data) ?? "Could not save the link (\(http.statusCode)).")
        }
    }

    private static func errorMessage(from data: Data) -> String? {
        struct ErrorBody: Decodable { let message: String }
        return try? JSONDecoder().decode(ErrorBody.self, from: data).message
    }
}
