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
        guard SharedStore.isConfigured, let serverURL = SharedStore.serverURL, let token = SharedStore.authToken else {
            return
        }

        Task {
            // Best-effort: an empty result just leaves "No group" as the only
            // option, same as if this fetch had never run.
            async let liveGroupTitles = PocketBaseClient.fetchGroupTitles(serverURL: serverURL, token: token)
            async let knownDestinations = PocketBaseClient.fetchKnownDestinations(serverURL: serverURL, token: token)
            let groups = Self.mergeGroupTitles(await liveGroupTitles, await knownDestinations)
            await MainActor.run {
                self.model.availableGroups = groups
            }
        }
    }

    /// Combines live browser tab groups with destinations already in use on
    /// shared links (which may only exist as iOS-created "virtual" groups),
    /// de-duplicating case-insensitively while preferring the live group's
    /// casing when both sources agree.
    private static func mergeGroupTitles(_ live: [String], _ known: [String]) -> [String] {
        var seen = Set<String>()
        var merged: [String] = []
        for title in live + known {
            let key = title.localizedLowercase
            guard seen.insert(key).inserted else { continue }
            merged.append(title)
        }
        return merged.sorted { $0.localizedStandardCompare($1) == .orderedAscending }
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
