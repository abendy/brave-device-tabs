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

struct SharedLink: Identifiable, Decodable, Equatable {
    let id: String
    let url: String
    let title: String?
    let source: String?
    let destination: String?
}

struct BrowserGroup: Decodable, Equatable {
    let title: String
    let windowID: Int
    let index: Int

    private enum CodingKeys: String, CodingKey {
        case title
        case windowID = "windowId"
        case index
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        title = try container.decode(String.self, forKey: .title)
        // Records written by older extension builds did not include windowId.
        windowID = try container.decodeIfPresent(Int.self, forKey: .windowID) ?? -1
        index = try container.decodeIfPresent(Int.self, forKey: .index) ?? .max
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

    enum SessionState {
        case valid
        case expired
        case unreachable
        case notConfigured
    }

    /// PocketBase list rules act as filters for requests whose token is dead:
    /// reads come back 200 with empty items, never 401, so no fetch in this
    /// app can reveal an expired session on its own (SYNC_REVIEW.md finding
    /// #10). This explicit refresh is the only reliable check, and a
    /// successful one rotates the stored token so regular use keeps the
    /// session alive. Only 401/403 means expired — network failures must stay
    /// distinguishable so offline is not treated as signed out.
    static func refreshSession() async -> SessionState {
        guard let serverURL = SharedStore.serverURL, let token = SharedStore.authToken else {
            return .notConfigured
        }

        var request = URLRequest(url: serverURL.appendingPathComponent("api/collections/users/auth-refresh"))
        request.httpMethod = "POST"
        request.setValue(token, forHTTPHeaderField: "Authorization")

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else { return .unreachable }
            guard (200..<300).contains(http.statusCode) else {
                return http.statusCode == 401 || http.statusCode == 403 ? .expired : .unreachable
            }

            struct AuthResponse: Decodable { let token: String }
            if let refreshed = try? JSONDecoder().decode(AuthResponse.self, from: data) {
                SharedStore.authToken = refreshed.token
            }
            return .valid
        } catch {
            return .unreachable
        }
    }

    static func shareLink(url: String, title: String?, source: String, destination: String?) async throws {
        guard let serverURL = SharedStore.serverURL, let token = SharedStore.authToken else {
            throw PocketBaseError.notConfigured
        }

        var request = URLRequest(url: serverURL.appendingPathComponent("api/collections/shared_links/records"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(token, forHTTPHeaderField: "Authorization")

        var body: [String: String] = ["url": url, "source": source]
        if let title, !title.isEmpty { body["title"] = title }
        if let destination, !destination.isEmpty { body["destination"] = destination }
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw PocketBaseError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            throw PocketBaseError.server(errorMessage(from: data) ?? "Could not save the link (\(http.statusCode)).")
        }
    }

    static func fetchSharedLinks() async throws -> [SharedLink] {
        guard let serverURL = SharedStore.serverURL, let token = SharedStore.authToken else {
            throw PocketBaseError.notConfigured
        }
        guard var components = URLComponents(
            url: serverURL.appendingPathComponent("api/collections/shared_links/records"),
            resolvingAgainstBaseURL: false
        ) else { throw PocketBaseError.invalidResponse }
        components.queryItems = [
            URLQueryItem(name: "filter", value: "(opened=false)"),
            URLQueryItem(name: "sort", value: "-created"),
        ]
        guard let url = components.url else { throw PocketBaseError.invalidResponse }

        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        request.setValue(token, forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw PocketBaseError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            throw PocketBaseError.server(errorMessage(from: data) ?? "Could not load links (\(http.statusCode)).")
        }

        struct ListResponse: Decodable { let items: [SharedLink] }
        return try JSONDecoder().decode(ListResponse.self, from: data).items
    }

    /// Empty string clears the destination, matching how the extension
    /// treats an empty `destination` as "no group" throughout.
    static func updateLinkDestination(id: String, destination: String?) async throws {
        guard let serverURL = SharedStore.serverURL, let token = SharedStore.authToken else {
            throw PocketBaseError.notConfigured
        }

        var request = URLRequest(
            url: serverURL.appendingPathComponent("api/collections/shared_links/records/\(id)")
        )
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(token, forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode(["destination": destination ?? ""])

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw PocketBaseError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            throw PocketBaseError.server(errorMessage(from: data) ?? "Could not move the link (\(http.statusCode)).")
        }
    }

    static func deleteSharedLink(id: String) async throws {
        guard let serverURL = SharedStore.serverURL, let token = SharedStore.authToken else {
            throw PocketBaseError.notConfigured
        }

        var request = URLRequest(
            url: serverURL.appendingPathComponent("api/collections/shared_links/records/\(id)")
        )
        request.httpMethod = "DELETE"
        request.setValue(token, forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw PocketBaseError.invalidResponse }
        guard (200..<300).contains(http.statusCode) || http.statusCode == 404 else {
            throw PocketBaseError.server(errorMessage(from: data) ?? "Could not delete the link (\(http.statusCode)).")
        }
    }

    /// Best-effort: an empty list just means the cycling picker only offers
    /// "No group" - a fetch failure here must never block sharing.
    static func fetchGroupTitles(serverURL: URL, token: String) async -> [String] {
        do {
            return try await fetchBrowserGroups(serverURL: serverURL, token: token).map(\.title)
        } catch {
            return []
        }
    }

    static func fetchBrowserGroups(serverURL: URL, token: String) async throws -> [BrowserGroup] {
        guard var components = URLComponents(
            url: serverURL.appendingPathComponent("api/collections/browser_groups/records"),
            resolvingAgainstBaseURL: false
        ) else { throw PocketBaseError.invalidResponse }
        components.queryItems = [URLQueryItem(name: "perPage", value: "1")]
        guard let url = components.url else { throw PocketBaseError.invalidResponse }

        var request = URLRequest(url: url)
        request.setValue(token, forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw PocketBaseError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            throw PocketBaseError.server(errorMessage(from: data) ?? "Could not load tab groups (\(http.statusCode)).")
        }

        struct Record: Decodable { let groups: [BrowserGroup] }
        struct ListResponse: Decodable { let items: [Record] }

        let list = try JSONDecoder().decode(ListResponse.self, from: data)
        return list.items.first?.groups ?? []
    }

    /// Best-effort for the same reason as `fetchGroupTitles`: covers group
    /// names created purely on iOS (via LinksView's New Group card or a prior
    /// "New group…" share) that have never synced back as a live browser tab
    /// group, so `fetchGroupTitles` alone wouldn't offer them.
    static func fetchKnownDestinations(serverURL: URL, token: String) async -> [String] {
        guard var components = URLComponents(
            url: serverURL.appendingPathComponent("api/collections/shared_links/records"),
            resolvingAgainstBaseURL: false
        ) else { return [] }
        components.queryItems = [
            URLQueryItem(name: "filter", value: "(opened=false)"),
            URLQueryItem(name: "fields", value: "destination"),
            URLQueryItem(name: "perPage", value: "200"),
        ]
        guard let url = components.url else { return [] }

        var request = URLRequest(url: url)
        request.setValue(token, forHTTPHeaderField: "Authorization")

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return [] }

            struct Record: Decodable { let destination: String? }
            struct ListResponse: Decodable { let items: [Record] }

            let items = try JSONDecoder().decode(ListResponse.self, from: data).items
            return items.compactMap { $0.destination?.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
        } catch {
            return []
        }
    }

    private static func errorMessage(from data: Data) -> String? {
        struct ErrorBody: Decodable { let message: String }
        return try? JSONDecoder().decode(ErrorBody.self, from: data).message
    }
}
