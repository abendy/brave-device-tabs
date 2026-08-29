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
}
