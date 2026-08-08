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
    let destinationWindowID: Int?

    private enum CodingKeys: String, CodingKey {
        case id, url, title, source, destination
        case destinationWindowID = "destinationWindowId"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        url = try container.decode(String.self, forKey: .url)
        title = try container.decodeIfPresent(String.self, forKey: .title)
        source = try container.decodeIfPresent(String.self, forKey: .source)
        destination = try container.decodeIfPresent(String.self, forKey: .destination)
        // PocketBase number fields read back 0 when unset.
        let windowID = try container.decodeIfPresent(Int.self, forKey: .destinationWindowID) ?? 0
        destinationWindowID = windowID > 0 ? windowID : nil
    }

    init(
        id: String, url: String, title: String?, source: String?,
        destination: String?, destinationWindowID: Int?
    ) {
        self.id = id
        self.url = url
        self.title = title
        self.source = source
        self.destination = destination
        self.destinationWindowID = destinationWindowID
    }
}

struct BrowserGroup: Decodable, Equatable {
    let title: String
    let windowID: Int
    let index: Int
    /// Chrome tab-group color name ("blue", "grey", …) as synced by the
    /// extension; nil on records from older builds.
    let color: String?

    private enum CodingKeys: String, CodingKey {
        case title
        case windowID = "windowId"
        case index
        case color
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        title = try container.decode(String.self, forKey: .title)
        // Records written by older extension builds did not include windowId.
        windowID = try container.decodeIfPresent(Int.self, forKey: .windowID) ?? -1
        index = try container.decodeIfPresent(Int.self, forKey: .index) ?? .max
        color = try container.decodeIfPresent(String.self, forKey: .color)
    }
}

private struct PocketBaseListResponse<Item: Decodable>: Decodable {
    let page: Int
    let perPage: Int
    let totalItems: Int
    let totalPages: Int
    let items: [Item]
}

private struct KnownDestinationRecord: Decodable {
    let destination: String?
    let destinationWindowId: Int?
}

enum PocketBaseClient {
    private static let sharedLinksPageSize = 200
    private static let sharedLinksMaxPages = 20

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

    static func shareLink(
        url: String, title: String?, source: String,
        destination: String?, destinationWindowID: Int? = nil
    ) async throws {
        guard let serverURL = SharedStore.serverURL, let token = SharedStore.authToken else {
            throw PocketBaseError.notConfigured
        }

        var request = URLRequest(url: serverURL.appendingPathComponent("api/collections/shared_links/records"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(token, forHTTPHeaderField: "Authorization")

        struct Payload: Encodable {
            let url: String
            let source: String
            let title: String?
            let destination: String?
            let destinationWindowId: Int?
        }
        request.httpBody = try JSONEncoder().encode(Payload(
            url: url,
            source: source,
            title: (title?.isEmpty == false) ? title : nil,
            destination: (destination?.isEmpty == false) ? destination : nil,
            destinationWindowId: (destination?.isEmpty == false) ? destinationWindowID : nil
        ))

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
        var page = 1
        var totalPages = 1
        var links: [SharedLink] = []

        while page <= totalPages && page <= sharedLinksMaxPages {
            components.queryItems = [
                URLQueryItem(name: "filter", value: "(opened=false)"),
                URLQueryItem(name: "sort", value: "-created"),
                URLQueryItem(name: "perPage", value: String(sharedLinksPageSize)),
                URLQueryItem(name: "page", value: String(page)),
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

            let list = try JSONDecoder().decode(PocketBaseListResponse<SharedLink>.self, from: data)
            links.append(contentsOf: list.items)
            totalPages = list.totalPages
            page += 1
        }

        return links
    }

    /// First unopened link with this exact URL, for duplicate warnings before
    /// a share. Callers treat failures as "no duplicate found" — reads with a
    /// dead token come back empty rather than failing (SYNC_REVIEW.md finding
    /// #10), so validate the session first for a trustworthy answer.
    static func findSharedLink(url: String) async throws -> SharedLink? {
        guard let serverURL = SharedStore.serverURL, let token = SharedStore.authToken else {
            throw PocketBaseError.notConfigured
        }
        guard var components = URLComponents(
            url: serverURL.appendingPathComponent("api/collections/shared_links/records"),
            resolvingAgainstBaseURL: false
        ) else { throw PocketBaseError.invalidResponse }
        let escaped = url
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
        components.queryItems = [
            URLQueryItem(name: "filter", value: "(opened=false && url='\(escaped)')"),
            URLQueryItem(name: "perPage", value: "1"),
        ]
        guard let requestURL = components.url else { throw PocketBaseError.invalidResponse }

        var request = URLRequest(url: requestURL, cachePolicy: .reloadIgnoringLocalCacheData)
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        request.setValue(token, forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw PocketBaseError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            throw PocketBaseError.server(errorMessage(from: data) ?? "Could not check for duplicates (\(http.statusCode)).")
        }

        let list = try JSONDecoder().decode(PocketBaseListResponse<SharedLink>.self, from: data)
        return list.items.first
    }

    /// Empty string clears the destination, matching how the extension
    /// treats an empty `destination` as "no group" throughout; 0 clears the
    /// window preference the same way.
    static func updateLinkDestination(id: String, destination: String?, windowID: Int? = nil) async throws {
        guard let serverURL = SharedStore.serverURL, let token = SharedStore.authToken else {
            throw PocketBaseError.notConfigured
        }

        var request = URLRequest(
            url: serverURL.appendingPathComponent("api/collections/shared_links/records/\(id)")
        )
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(token, forHTTPHeaderField: "Authorization")
        struct Payload: Encodable {
            let destination: String
            let destinationWindowId: Int
        }
        request.httpBody = try JSONEncoder().encode(Payload(
            destination: destination ?? "",
            destinationWindowId: windowID ?? 0
        ))

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

    struct KnownDestination: Equatable {
        let title: String
        let windowID: Int?
    }

    /// Best-effort — a failure here must never block sharing. Covers group
    /// names created purely on iOS (via LinksView's New Group card or a prior
    /// "New group…" share) that have never synced back as a live browser tab
    /// group, so `fetchBrowserGroups` alone wouldn't offer them.
    static func fetchKnownDestinations(serverURL: URL, token: String) async -> [KnownDestination] {
        guard var components = URLComponents(
            url: serverURL.appendingPathComponent("api/collections/shared_links/records"),
            resolvingAgainstBaseURL: false
        ) else { return [] }
        var page = 1
        var totalPages = 1
        var records: [KnownDestinationRecord] = []

        do {
            while page <= totalPages && page <= sharedLinksMaxPages {
                components.queryItems = [
                    URLQueryItem(name: "filter", value: "(opened=false)"),
                    URLQueryItem(name: "fields", value: "destination,destinationWindowId"),
                    URLQueryItem(name: "perPage", value: String(sharedLinksPageSize)),
                    URLQueryItem(name: "page", value: String(page)),
                ]
                guard let url = components.url else { throw PocketBaseError.invalidResponse }

                var request = URLRequest(url: url)
                request.setValue(token, forHTTPHeaderField: "Authorization")

                let (data, response) = try await URLSession.shared.data(for: request)
                guard let http = response as? HTTPURLResponse else { throw PocketBaseError.invalidResponse }
                guard (200..<300).contains(http.statusCode) else {
                    throw PocketBaseError.server(
                        errorMessage(from: data) ?? "Could not load known destinations (\(http.statusCode))."
                    )
                }

                let list = try JSONDecoder().decode(PocketBaseListResponse<KnownDestinationRecord>.self, from: data)
                records.append(contentsOf: list.items)
                totalPages = list.totalPages
                page += 1
            }
        } catch {
            // Keep successfully decoded pages when a later page fails; this is best-effort.
        }

        return records.compactMap { record -> KnownDestination? in
            guard
                let title = record.destination?.trimmingCharacters(in: .whitespacesAndNewlines),
                !title.isEmpty
            else { return nil }
            let windowID = record.destinationWindowId ?? 0
            return KnownDestination(title: title, windowID: windowID > 0 ? windowID : nil)
        }
    }

    private static func errorMessage(from data: Data) -> String? {
        struct ErrorBody: Decodable { let message: String }
        return try? JSONDecoder().decode(ErrorBody.self, from: data).message
    }
}
