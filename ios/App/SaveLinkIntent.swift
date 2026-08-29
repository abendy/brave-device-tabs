import AppIntents
import UIKit

/// Shortcuts entry point: "Save Link to Device Tabs". Takes the link as a
/// parameter (wire Shortcuts' own "Get Clipboard" into it for a
/// copy-then-save flow — Shortcuts owns the clipboard permission that way)
/// plus an optional group whose suggestions come from pinned groups and
/// live browser groups. Runs without opening the app.
struct SaveLinkIntent: AppIntent {
    static let title: LocalizedStringResource = "Save Link to Device Tabs"
    static let description = IntentDescription(
        "Saves a link for your browser, optionally into a tab group."
    )
    static let openAppWhenRun = false

    @Parameter(title: "Link")
    var url: URL

    @Parameter(title: "Group", optionsProvider: GroupOptionsProvider())
    var group: String?

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard SharedStore.isConfigured else {
            throw SaveLinkError.notConfigured
        }
        // A dead token would make the save be rejected with a confusing
        // server error (SYNC_REVIEW.md finding #10) — validate first.
        switch await PocketBaseClient.refreshSession() {
        case .valid:
            break
        case .expired, .notConfigured:
            throw SaveLinkError.notConfigured
        case .unreachable:
            throw SaveLinkError.unreachable
        }

        let trimmedGroup = group?.trimmingCharacters(in: .whitespacesAndNewlines)
        try await PocketBaseClient.shareLink(
            url: url.absoluteString,
            title: nil,
            source: UIDevice.current.name,
            destination: trimmedGroup,
            destinationWindowID: nil
        )
        let destination = (trimmedGroup?.isEmpty == false) ? "“\(trimmedGroup ?? "")”" : "No group"
        return .result(dialog: "Saved to \(destination)")
    }
}

private struct GroupOptionsProvider: DynamicOptionsProvider {
    func results() async throws -> [String] {
        guard let serverURL = SharedStore.serverURL, let token = SharedStore.authToken else {
            return []
        }
        // Pins lead, mirroring the share sheet's emphasis on standing
        // destinations; live group titles follow.
        let pinned = await PocketBaseClient.fetchPinnedGroups(serverURL: serverURL, token: token)
            .map(\.title)
        let live = ((try? await PocketBaseClient.fetchBrowserGroups(serverURL: serverURL, token: token)) ?? [])
            .map(\.title)
        var seen = Set<String>()
        return (pinned + live)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty && seen.insert($0.localizedLowercase).inserted }
    }
}

private enum SaveLinkError: Error, CustomLocalizedStringResourceConvertible {
    case notConfigured
    case unreachable

    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .notConfigured:
            return "Open the Device Tabs Share app and sign in first."
        case .unreachable:
            return "The Shared Links server could not be reached."
        }
    }
}
