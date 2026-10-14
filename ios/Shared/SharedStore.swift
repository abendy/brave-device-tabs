import Foundation

/// Backed by an App Group so the container app's sign-in and the share
/// extension's POST see the same server URL and token. A shared UserDefaults
/// suite is enough for this — a personal single-user token doesn't need
/// Keychain's at-rest encryption to justify the extra entitlement/signing
/// fragility (Keychain access groups must match your Team ID exactly).
enum SharedStore {
    private static let suiteName = "group.com.abendy.devicetabs"
    private static let serverURLKey = "pocketbaseServerURL"
    private static let tokenKey = "pocketbaseAuthToken"

    private static var defaults: UserDefaults? {
        UserDefaults(suiteName: suiteName)
    }

    static var serverURL: URL? {
        get { defaults?.string(forKey: serverURLKey).flatMap(URL.init(string:)) }
        set { defaults?.set(newValue?.absoluteString, forKey: serverURLKey) }
    }

    static var authToken: String? {
        get { defaults?.string(forKey: tokenKey) }
        set { defaults?.set(newValue, forKey: tokenKey) }
    }

    static var isConfigured: Bool {
        serverURL != nil && authToken != nil
    }

    private static let lastQuickSaveChangeCountKey = "lastQuickSaveChangeCount"

    /// The UIPasteboard.changeCount most recently offered (or handled) by
    /// clipboard quick-save, so reopening the app doesn't re-offer the same
    /// copied link.
    static var lastQuickSaveChangeCount: Int {
        get { defaults?.integer(forKey: lastQuickSaveChangeCountKey) ?? -1 }
        set { defaults?.set(newValue, forKey: lastQuickSaveChangeCountKey) }
    }

    private static let collapsedShareWindowsKey = "collapsedShareWindows"

    /// Window ids whose share-sheet cluster is collapsed. Window ids are
    /// ephemeral across browser restarts, so stale entries simply stop
    /// matching and the replacement window starts expanded (the default).
    static var collapsedShareWindowIDs: Set<Int> {
        get { Set(defaults?.array(forKey: collapsedShareWindowsKey) as? [Int] ?? []) }
        set { defaults?.set(Array(newValue).sorted(), forKey: collapsedShareWindowsKey) }
    }

    private static let destinationUsageKey = "destinationUsage"
    private static let destinationUsageLimit = 50

    struct DestinationUsage: Codable, Equatable {
        var count: Int
        var lastUsed: Date
    }

    /// Save history per group title (lowercased; window ids don't survive
    /// browser restarts) that ranks the share sheet's common and recent
    /// groups. Local to this device and capped to the most recent titles.
    static var destinationUsage: [String: DestinationUsage] {
        get {
            guard let data = defaults?.data(forKey: destinationUsageKey) else { return [:] }
            return (try? JSONDecoder().decode([String: DestinationUsage].self, from: data)) ?? [:]
        }
        set { defaults?.set(try? JSONEncoder().encode(newValue), forKey: destinationUsageKey) }
    }

    /// Ungrouped saves carry no title and are not tracked.
    static func recordDestinationUse(title: String?, at date: Date = Date()) {
        let key = title?.trimmingCharacters(in: .whitespacesAndNewlines).localizedLowercase ?? ""
        guard !key.isEmpty else { return }
        var usage = destinationUsage
        usage[key, default: DestinationUsage(count: 0, lastUsed: date)].count += 1
        usage[key]?.lastUsed = date
        if usage.count > destinationUsageLimit {
            let kept = usage.sorted { $0.value.lastUsed > $1.value.lastUsed }
                .prefix(destinationUsageLimit)
            usage = Dictionary(uniqueKeysWithValues: kept.map { ($0.key, $0.value) })
        }
        destinationUsage = usage
    }
}
