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
        model.loadDestinations()
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
                    self?.model.checkForDuplicate()
                }
            }
        } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) { [weak self] item, _ in
                guard let text = item as? String else { return }
                DispatchQueue.main.async {
                    self?.model.sharedURL = Self.firstURL(in: text)
                    self?.model.checkForDuplicate()
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
