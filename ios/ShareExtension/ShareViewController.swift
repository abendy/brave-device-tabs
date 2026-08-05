import SwiftUI
import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    private let model = ShareComposeModel()

    override func viewDidLoad() {
        super.viewDidLoad()

        model.onCancel = { [weak self] in
            self?.extensionContext?.cancelRequest(withError: NSError(domain: "DeviceTabsShare", code: 0))
        }
        model.onComplete = { [weak self] in
            self?.extensionContext?.completeRequest(returningItems: nil)
        }

        embedComposeView()
        loadAttachment()
        loadGroups()
    }

    private func embedComposeView() {
        let hosting = UIHostingController(rootView: ShareComposeView(model: model))
        addChild(hosting)
        hosting.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(hosting.view)
        NSLayoutConstraint.activate([
            hosting.view.topAnchor.constraint(equalTo: view.topAnchor),
            hosting.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            hosting.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            hosting.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        hosting.didMove(toParent: self)
    }

    private func loadGroups() {
        guard SharedStore.isConfigured else {
            return
        }

        Task {
            // A dead token would make both group sources below return empty
            // instead of failing (SYNC_REVIEW.md finding #10), and the save
            // itself could only be rejected — surface that state instead.
            // The stored token is never cleared from here; only the app owns
            // sign-in state.
            let session = await PocketBaseClient.refreshSession()
            if session == .expired {
                await MainActor.run {
                    self.model.isSessionExpired = true
                }
                return
            }
            guard let serverURL = SharedStore.serverURL, let token = SharedStore.authToken else {
                return
            }

            // Best-effort: empty sections just leave "No group" and "New
            // group…" as the only options, same as if these fetches had
            // never run.
            async let liveGroupsTask: [BrowserGroup] = {
                (try? await PocketBaseClient.fetchBrowserGroups(serverURL: serverURL, token: token)) ?? []
            }()
            async let knownDestinationsTask = PocketBaseClient.fetchKnownDestinations(
                serverURL: serverURL, token: token
            )
            let sections = Self.destinationSections(
                live: await liveGroupsTask, known: await knownDestinationsTask
            )
            await MainActor.run {
                self.model.pendingGroups = sections.pending
                self.model.windowGroups = sections.byWindow
            }
        }
    }

    /// Mirrors the Links screen's ordering: iOS-created destinations with no
    /// live browser tab group yet come first, then live groups clustered per
    /// window (windows ascending, groups by first-tab index then title).
    /// Unlike that screen, a menu picker cannot offer the same title twice —
    /// the tag would be ambiguous — so a title duplicated across windows
    /// keeps only its first window's row.
    private static func destinationSections(
        live: [BrowserGroup], known: [String]
    ) -> (pending: [String], byWindow: [[String]]) {
        var claimedTitles = Set<String>()
        var groupsByWindow: [Int: [(title: String, sortIndex: Int)]] = [:]

        for group in live {
            let title = group.title.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !title.isEmpty, claimedTitles.insert(title.localizedLowercase).inserted else {
                continue
            }
            groupsByWindow[group.windowID, default: []].append((title, group.index))
        }

        let byWindow = groupsByWindow.keys.sorted().map { windowID in
            (groupsByWindow[windowID] ?? [])
                .sorted {
                    $0.sortIndex == $1.sortIndex
                        ? $0.title.localizedStandardCompare($1.title) == .orderedAscending
                        : $0.sortIndex < $1.sortIndex
                }
                .map(\.title)
        }

        var seenPending = Set<String>()
        let pending = known
            .filter { !claimedTitles.contains($0.localizedLowercase) }
            .filter { seenPending.insert($0.localizedLowercase).inserted }
            .sorted { $0.localizedStandardCompare($1) == .orderedAscending }

        return (pending, byWindow)
    }

    private func loadAttachment() {
        guard
            let item = extensionContext?.inputItems.first as? NSExtensionItem,
            let provider = item.attachments?.first
        else { return }

        if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
            provider.loadItem(forTypeIdentifier: UTType.url.identifier) { [weak self] item, _ in
                guard let url = item as? URL else { return }
                DispatchQueue.main.async {
                    self?.model.sharedURL = url
                }
            }
        } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) { [weak self] item, _ in
                guard let text = item as? String else { return }
                DispatchQueue.main.async {
                    self?.model.sharedURL = Self.firstURL(in: text)
                }
            }
        }
    }

    private static func firstURL(in text: String) -> URL? {
        guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else {
            return URL(string: text)
        }
        let range = NSRange(text.startIndex..., in: text)
        return detector.firstMatch(in: text, range: range)?.url
    }
}
