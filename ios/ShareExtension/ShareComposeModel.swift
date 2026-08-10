import UIKit

/// Owns all share-compose state. A plain ObservableObject rather than
/// SLComposeServiceViewController's built-in state, since that framework's
/// configuration-items mechanism turned out not to render on this iOS
/// version despite being invoked correctly (confirmed via logging) - see
/// DEBUG.md.
final class ShareComposeModel: ObservableObject {
    enum Destination: Hashable {
        /// A window id without a title saves the link ungrouped but still
        /// aimed at that window.
        case none(windowID: Int?)
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
    }

    @Published var sharedURL: URL?
    /// iOS-created destinations with no live browser tab group yet — the
    /// Links screen's "Other groups". They lead the destination list because a group just
    /// created from iOS is the most likely pick when saving more links to it.
    @Published var pendingGroups: [DestinationOption] = []
    /// Live browser tab groups clustered per window, in the Links screen's
    /// window and in-window order, with their Chrome colors.
    @Published var windowGroups: [WindowGroupCluster] = []
    @Published var selectedDestination: Destination = .none(windowID: nil)
    @Published var newGroupName: String = ""
    @Published var isPosting = false
    @Published var isSessionExpired = false
    @Published var saveErrorMessage: String?
    /// An unopened link with the same URL, when one already exists; drives
    /// the "Already saved" banner and the Save Anyway button title.
    @Published var duplicateOf: SharedLink?
    /// Non-nil once the save succeeded; the sheet shows this confirmation
    /// briefly and then dismisses itself.
    @Published var savedSummary: String?

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

        // A duplicate turns Post into Move: the existing record is
        // re-targeted at the chosen destination instead of saving a second
        // copy of the same URL.
        let duplicate = duplicateOf

        Task {
            do {
                if let duplicate {
                    try await PocketBaseClient.updateLinkDestination(
                        id: duplicate.id,
                        destination: destination.title,
                        windowID: destination.windowID
                    )
                } else {
                    try await PocketBaseClient.shareLink(
                        url: sharedURL.absoluteString,
                        title: nil,
                        source: UIDevice.current.name,
                        destination: destination.title,
                        destinationWindowID: destination.windowID
                    )
                }
                await MainActor.run {
                    self.isPosting = false
                    let label = self.destinationLabel(
                        title: destination.title, windowID: destination.windowID
                    )
                    self.savedSummary = "\(duplicate == nil ? "Saved" : "Moved") to \(label)"
                }
                // Leave the confirmation on screen long enough to read
                // before the sheet dismisses itself.
                try? await Task.sleep(nanoseconds: 1_200_000_000)
                await MainActor.run {
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

    /// Best-effort: no banner is shown when the probe cannot get a
    /// trustworthy answer (unreachable, expired, or misconfigured).
    func checkForDuplicate() {
        guard isConfigured, let sharedURL else { return }
        let urlString = sharedURL.absoluteString

        Task {
            // A dead token would make the probe read back empty instead of
            // failing (SYNC_REVIEW.md finding #10) — validate first so a
            // missing banner can't just mean a silently dead session.
            guard await PocketBaseClient.refreshSession() == .valid else { return }
            let existing = (try? await PocketBaseClient.findSharedLink(url: urlString)) ?? nil
            await MainActor.run {
                guard self.sharedURL?.absoluteString == urlString else { return }
                self.duplicateOf = existing
            }
        }
    }

    /// Human-readable destination for banners: "No group", "“Reading List”",
    /// or "“Reading List” · Window 2". Window numbers follow the sheet's
    /// cluster order (ascending window id), matching the popup's numbering;
    /// a window that is no longer live gets no number.
    func destinationLabel(title: String?, windowID: Int?) -> String {
        let trimmed = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let windowSuffix: String
        if let windowID, let index = windowGroups.firstIndex(where: { $0.windowID == windowID }) {
            windowSuffix = " · Window \(index + 1)"
        } else {
            windowSuffix = ""
        }
        guard !trimmed.isEmpty else { return "No group\(windowSuffix)" }
        return "“\(trimmed)”\(windowSuffix)"
    }

    func cancel() {
        onCancel?()
    }

    private func resolvedDestination() -> (title: String?, windowID: Int?) {
        switch selectedDestination {
        case .none(let windowID):
            return (nil, windowID)
        case .existing(let title, let windowID):
            return (title, windowID)
        case .new(let windowID):
            let trimmed = newGroupName.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? (nil, nil) : (trimmed, windowID)
        }
    }
}
