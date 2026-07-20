import Social
import UIKit
import UniformTypeIdentifiers

final class ShareViewController: SLComposeServiceViewController {
    private var sharedURL: URL?

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Save to Device Tabs"
        loadAttachment()

        if !SharedStore.isConfigured {
            textView.text = "Open the Device Tabs Share app and sign in first."
            textView.isEditable = false
        }
    }

    override func isContentValid() -> Bool {
        SharedStore.isConfigured && sharedURL != nil
    }

    override func didSelectPost() {
        guard let sharedURL else {
            extensionContext?.completeRequest(returningItems: nil)
            return
        }

        let note = contentText ?? ""
        Task {
            // Best-effort: the share sheet has already dismissed by the time
            // this runs, so there's no UI left to surface a failure through.
            try? await PocketBaseClient.shareLink(
                url: sharedURL.absoluteString,
                title: note.isEmpty ? nil : note,
                source: UIDevice.current.name
            )
            extensionContext?.completeRequest(returningItems: nil)
        }
    }

    override func configurationItems() -> [Any]! {
        []
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
                    self?.sharedURL = url
                    self?.validateContent()
                }
            }
        } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) { [weak self] item, _ in
                guard let text = item as? String else { return }
                DispatchQueue.main.async {
                    self?.sharedURL = Self.firstURL(in: text)
                    self?.validateContent()
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
