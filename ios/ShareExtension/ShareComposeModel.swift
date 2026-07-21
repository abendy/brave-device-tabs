import UIKit

/// Owns all share-compose state. A plain ObservableObject rather than
/// SLComposeServiceViewController's built-in state, since that framework's
/// configuration-items mechanism turned out not to render on this iOS
/// version despite being invoked correctly (confirmed via logging) - see
/// DEBUG.md.
final class ShareComposeModel: ObservableObject {
    @Published var sharedURL: URL?
    @Published var noteText: String = ""
    @Published var availableGroups: [String] = []
    @Published var selectedGroup: String?
    @Published var isPosting = false

    var onCancel: (() -> Void)?
    var onComplete: (() -> Void)?

    var isConfigured: Bool { SharedStore.isConfigured }

    func post() {
        guard let sharedURL else {
            onComplete?()
            return
        }

        isPosting = true
        let note = noteText
        let destination = selectedGroup

        Task {
            // Best-effort: the share sheet is about to dismiss regardless, so
            // there's no UI left to surface a failure through.
            try? await PocketBaseClient.shareLink(
                url: sharedURL.absoluteString,
                title: note.isEmpty ? nil : note,
                source: UIDevice.current.name,
                destination: destination
            )
            await MainActor.run {
                self.isPosting = false
                self.onComplete?()
            }
        }
    }

    func cancel() {
        onCancel?()
    }
}
