import UIKit

/// Owns all share-compose state. A plain ObservableObject rather than
/// SLComposeServiceViewController's built-in state, since that framework's
/// configuration-items mechanism turned out not to render on this iOS
/// version despite being invoked correctly (confirmed via logging) - see
/// DEBUG.md.
final class ShareComposeModel: ObservableObject {
    enum Destination: Hashable {
        case none
        case existing(String)
        case new
    }

    @Published var sharedURL: URL?
    @Published var noteText: String = ""
    @Published var availableGroups: [String] = []
    @Published var selectedDestination: Destination = .none
    @Published var newGroupName: String = ""
    @Published var isPosting = false

    var onCancel: (() -> Void)?
    var onComplete: (() -> Void)?

    var isConfigured: Bool { SharedStore.isConfigured }

    /// Disables Post while "New group…" is selected but no name has been
    /// entered yet, since that combination has nothing to send.
    var isNewGroupNameMissing: Bool {
        guard case .new = selectedDestination else { return false }
        return newGroupName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    func post() {
        guard let sharedURL else {
            onComplete?()
            return
        }

        isPosting = true
        let note = noteText
        let destination = resolvedDestination()

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

    private func resolvedDestination() -> String? {
        switch selectedDestination {
        case .none: return nil
        case .existing(let group): return group
        case .new:
            let trimmed = newGroupName.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }
    }
}
