import SwiftUI
import UniformTypeIdentifiers

/// Shows shared links grouped by their destination tab group, with drag and
/// drop to move a link between groups. Every known group renders even when it
/// has no links so there is always somewhere to drop.
struct LinksView: View {
    var onOpenSettings: () -> Void

    @State private var links: [SharedLink] = []
    @State private var groupTitles: [String] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var dragContext: LinkDragContext?
    @State private var moveErrorMessage: String?

    private static let noGroupTitle = "No group"

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Links")
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            onOpenSettings()
                        } label: {
                            Image(systemName: "gearshape")
                        }
                        .accessibilityLabel("Settings")
                    }
                }
                .task { await load() }
                .refreshable { await load() }
                .alert(
                    "Couldn't move link",
                    isPresented: Binding(
                        get: { moveErrorMessage != nil },
                        set: { if !$0 { moveErrorMessage = nil } }
                    )
                ) {
                    Button("OK", role: .cancel) {}
                } message: {
                    Text(moveErrorMessage ?? "The link could not be moved.")
                }
        }
    }

    @ViewBuilder
    private var content: some View {
        if isLoading && links.isEmpty && errorMessage == nil {
            ProgressView("Loading links…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let errorMessage, links.isEmpty {
            VStack(spacing: 12) {
                Image(systemName: "exclamationmark.triangle")
                    .font(.largeTitle)
                    .foregroundStyle(.secondary)
                Text("Couldn't load links")
                    .font(.headline)
                Text(errorMessage)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                Button("Retry") { Task { await load() } }
            }
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 20) {
                    ForEach(sections) { section in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(section.title)
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                                .textCase(.uppercase)
                                .padding(.horizontal, 4)

                            GroupDropTarget(
                                sectionID: section.id,
                                destination: section.destination,
                                links: section.links,
                                dragContext: $dragContext,
                                onDrop: move
                            )
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
            .background(Color(uiColor: .systemGroupedBackground).ignoresSafeArea())
        }
    }

    fileprivate struct LinkSection: Identifiable {
        var id: String { destination.map { "group:\($0)" } ?? "no-group" }
        let title: String
        /// nil clears the link's destination; matches `move(linkID:to:)`.
        let destination: String?
        let links: [SharedLink]
    }

    /// Treats nil, empty, and whitespace-only destinations as the same "no
    /// group" state — PocketBase returns "" rather than null for an unset
    /// text field, so this keeps that indistinguishable from never having
    /// dropped a link into a group.
    private func normalizedDestination(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
            return nil
        }
        return trimmed
    }

    private var sections: [LinkSection] {
        var byDestination: [String: [SharedLink]] = [:]
        var noGroup: [SharedLink] = []
        for link in links {
            if let destination = normalizedDestination(link.destination) {
                byDestination[destination, default: []].append(link)
            } else {
                noGroup.append(link)
            }
        }

        var titles: [String] = []
        for title in groupTitles.compactMap({ normalizedDestination($0) }) where !titles.contains(title) {
            titles.append(title)
        }
        for destination in byDestination.keys where !titles.contains(destination) {
            titles.append(destination)
        }
        titles.sort { $0.localizedStandardCompare($1) == .orderedAscending }

        let groupSections = titles.map { title in
            LinkSection(title: title, destination: title, links: byDestination[title] ?? [])
        }
        return [LinkSection(title: Self.noGroupTitle, destination: nil, links: noGroup)] + groupSections
    }

    private func move(linkID: String, to destination: String?) {
        guard let index = links.firstIndex(where: { $0.id == linkID }) else { return }
        let link = links[index]
        guard normalizedDestination(link.destination) != normalizedDestination(destination) else { return }

        let previousDestination = link.destination
        links[index] = SharedLink(
            id: link.id, url: link.url, title: link.title, source: link.source, destination: destination
        )

        Task {
            do {
                try await PocketBaseClient.updateLinkDestination(id: linkID, destination: destination)
            } catch {
                if let rollbackIndex = links.firstIndex(where: { $0.id == linkID }) {
                    let current = links[rollbackIndex]
                    links[rollbackIndex] = SharedLink(
                        id: current.id, url: current.url, title: current.title, source: current.source,
                        destination: previousDestination
                    )
                }
                moveErrorMessage = error.localizedDescription
            }
        }
    }

    private func load() async {
        guard let serverURL = SharedStore.serverURL, let token = SharedStore.authToken else { return }
        isLoading = true
        errorMessage = nil

        async let groupTitlesTask = PocketBaseClient.fetchGroupTitles(serverURL: serverURL, token: token)
        do {
            links = try await PocketBaseClient.fetchSharedLinks()
            groupTitles = await groupTitlesTask
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

private struct LinkDragContext {
    let linkID: String
    let sourceSectionID: String
}

/// A stable, card-sized target for one group. The normal rows remain in the
/// layout while targeted so the target cannot collapse away from the pointer;
/// they are visually replaced by the dashed drop-ready state.
private struct GroupDropTarget: View {
    let sectionID: String
    let destination: String?
    let links: [SharedLink]
    @Binding var dragContext: LinkDragContext?
    let onDrop: (_ linkID: String, _ destination: String?) -> Void

    @State private var isTargeted = false

    var body: some View {
        ZStack {
            rows
                .opacity(isTargeted ? 0 : 1)
                .allowsHitTesting(!isTargeted)
                .accessibilityHidden(isTargeted)

            if isTargeted {
                DropReadyView()
                    .allowsHitTesting(false)
                    .transition(.opacity.combined(with: .scale(scale: 0.98)))
            }
        }
        .frame(maxWidth: .infinity, minHeight: 72, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color(uiColor: .secondarySystemGroupedBackground))
        )
        .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .animation(.easeInOut(duration: 0.15), value: isTargeted)
        .onDrop(
            of: [.plainText],
            delegate: LinkDropDelegate(
                sectionID: sectionID,
                destination: destination,
                dragContext: $dragContext,
                isTargeted: $isTargeted,
                onDrop: onDrop
            )
        )
    }

    @ViewBuilder
    private var rows: some View {
        if links.isEmpty {
            Text("Drag a link here")
                .font(.footnote)
                .foregroundStyle(.tertiary)
                .frame(maxWidth: .infinity, minHeight: 72, alignment: .leading)
                .padding(.horizontal, 16)
        } else {
            VStack(spacing: 0) {
                ForEach(links) { link in
                    if link.id != links.first?.id {
                        Divider()
                            .padding(.leading, 16)
                    }

                    LinkRow(link: link)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .contentShape(Rectangle())
                        .accessibilityHint("Drag to move this link to another group")
                        .onDrag {
                            dragContext = LinkDragContext(linkID: link.id, sourceSectionID: sectionID)
                            return NSItemProvider(object: link.id as NSString)
                        }
                }
            }
        }
    }
}

private struct DropReadyView: View {
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.accentColor.opacity(0.08))
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(
                    Color.accentColor,
                    style: StrokeStyle(lineWidth: 2, dash: [7, 5])
                )
            Text("Drop here")
                .font(.headline)
                .foregroundStyle(Color.accentColor)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// Resolves accepted in-app drags from local state. This makes the move happen
/// synchronously at drop time instead of depending on an asynchronous item
/// provider callback after the drop interaction has already ended.
private struct LinkDropDelegate: DropDelegate {
    let sectionID: String
    let destination: String?
    @Binding var dragContext: LinkDragContext?
    @Binding var isTargeted: Bool
    let onDrop: (_ linkID: String, _ destination: String?) -> Void

    func validateDrop(info: DropInfo) -> Bool {
        guard info.hasItemsConforming(to: [.plainText]), let dragContext else { return false }
        return dragContext.sourceSectionID != sectionID
    }

    func dropEntered(info: DropInfo) {
        isTargeted = true
    }

    func dropUpdated(info: DropInfo) -> DropProposal? {
        if !isTargeted {
            isTargeted = true
        }
        return DropProposal(operation: .move)
    }

    func dropExited(info: DropInfo) {
        isTargeted = false
    }

    func performDrop(info: DropInfo) -> Bool {
        defer { isTargeted = false }
        guard
            !info.itemProviders(for: [.plainText]).isEmpty,
            let dragContext,
            dragContext.sourceSectionID != sectionID
        else { return false }

        self.dragContext = nil
        onDrop(dragContext.linkID, destination)
        return true
    }
}

private struct LinkRow: View {
    let link: SharedLink

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text((link.title?.isEmpty == false ? link.title : nil) ?? link.url)
                .font(.body)
                .lineLimit(2)
            HStack(spacing: 4) {
                if let source = link.source, !source.isEmpty {
                    Text(source)
                }
                Text(link.url)
                    .lineLimit(1)
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }
}
