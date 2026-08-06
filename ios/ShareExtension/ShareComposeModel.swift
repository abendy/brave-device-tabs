import UIKit

/// Owns all share-compose state. A plain ObservableObject rather than
/// SLComposeServiceViewController's built-in state, since that framework's
/// configuration-items mechanism turned out not to render on this iOS
/// version despite being invoked correctly (confirmed via logging) - see
/// DEBUG.md.
final class ShareComposeModel: ObservableObject {
    enum Destination: Hashable {
        case none
        case existing(title: String, windowID: Int?)
        case new(windowID: Int?)
    }

    struct DestinationOption: Hashable {
        let title: String
        let windowID: Int?
    }

    struct GroupOption: Hashable {
        let title: String
        let color: String?
    }

    struct WindowGroupCluster: Hashable {
        let windowID: Int
        let groups: [GroupOption]

        var preview: String {
            let titles = groups.map(\.title)
            let shown = titles.prefix(3).joined(separator: ", ")
            let remaining = titles.count - 3
            return remaining > 0 ? "\(shown) +\(remaining)" : shown
        }
    }

    @Published var sharedURL: URL?
    /// iOS-created destinations with no live browser tab group yet — the
    /// Links screen's "Other groups". They lead the destination list because a group just
    /// created from iOS is the most likely pick when saving more links to it.
    @Published var pendingGroups: [DestinationOption] = []
    /// Live browser tab groups clustered per window, in the Links screen's
    /// window and in-window order, with their Chrome colors.
    @Published var windowGroups: [WindowGroupCluster] = []
    @Published var selectedDestination: Destination = .none
    @Published var newGroupName: String = ""
    @Published var isPosting = false
    @Published var isSessionExpired = false
    @Published var saveErrorMessage: String?

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
        let destination = resolvedDestination()

        Task {
            do {
                try await PocketBaseClient.shareLink(
                    url: sharedURL.absoluteString,
                    title: nil,
                    source: UIDevice.current.name,
                    destination: destination.title,
                    destinationWindowID: destination.windowID
                )
                await MainActor.run {
                    self.isPosting = false
                    self.onComplete?()
                }
            } catch {
                await MainActor.run {
                    self.saveErrorMessage = error.localizedDescription
                    self.isPosting = false
                }
            }
        }
    }

    func cancel() {
        onCancel?()
    }

    private func resolvedDestination() -> (title: String?, windowID: Int?) {
        switch selectedDestination {
        case .none:
            return (nil, nil)
        case .existing(let title, let windowID):
            return (title, windowID)
        case .new(let windowID):
            let trimmed = newGroupName.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? (nil, nil) : (trimmed, windowID)
        }
    }
}
