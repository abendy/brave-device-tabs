import SwiftUI
import UniformTypeIdentifiers

/// Shows shared links grouped by their destination tab group, with drag and
/// drop to move a link between groups. Every known group renders even when it
/// has no links so there is always somewhere to drop.
struct LinksView: View {
    var onOpenSettings: () -> Void

    @Environment(\.scenePhase) private var scenePhase
    @State private var links: [SharedLink] = []
    @State private var browserGroups: [BrowserGroup] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var hasCompletedInitialLoad = false
    @State private var dragContext: LinkDragContext?
    @State private var moveErrorMessage: String?
    @State private var deleteErrorMessage: String?

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
                .task {
                    await load()
                    hasCompletedInitialLoad = true
                }
                .onChange(of: scenePhase) { _, newPhase in
                    guard newPhase == .active, hasCompletedInitialLoad else { return }
                    Task { await load() }
                }
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
                .alert(
                    "Couldn't delete link",
                    isPresented: Binding(
                        get: { deleteErrorMessage != nil },
                        set: { if !$0 { deleteErrorMessage = nil } }
                    )
                ) {
                    Button("OK", role: .cancel) {}
                } message: {
                    Text(deleteErrorMessage ?? "The link could not be deleted.")
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
                Button("Retry", action: retryLoad)
            }
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 20) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(noGroupSection.title)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .textCase(.uppercase)
                            .padding(.horizontal, 4)

                        GroupDropTarget(
                            sectionID: noGroupSection.id,
                            destination: noGroupSection.destination,
                            links: noGroupSection.links,
                            dragContext: $dragContext,
                            onDrop: move,
                            onDelete: delete
                        )
                    }

                    ForEach(windowSections) { window in
                        WindowGroupDisclosure(
                            window: window,
                            dragContext: $dragContext,
                            onDrop: move,
                            onDelete: delete
                        )
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
            .scrollBounceBehavior(.always)
            .refreshable { await load() }
            .alert(
                "Couldn't refresh links",
                isPresented: Binding(
                    get: { errorMessage != nil && !links.isEmpty },
                    set: { if !$0 { errorMessage = nil } }
                )
            ) {
                Button("Retry", action: retryLoad)
                Button("OK", role: .cancel) {}
            } message: {
                Text(errorMessage ?? "The links could not be refreshed.")
            }
            .background(Color(uiColor: .systemGroupedBackground).ignoresSafeArea())
        }
    }

    fileprivate struct LinkSection: Identifiable {
        let id: String
        let title: String
        let sortIndex: Int
        /// nil clears the link's destination; matches `move(linkID:to:)`.
        let destination: String?
        let links: [SharedLink]
    }

    fileprivate struct WindowSection: Identifiable {
        let id: String
        let title: String
        let groups: [LinkSection]
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

    private var groupedLinks: (byDestination: [String: [SharedLink]], noGroup: [SharedLink]) {
        var byDestination: [String: [SharedLink]] = [:]
        var noGroup: [SharedLink] = []
        for link in links {
            if let destination = normalizedDestination(link.destination) {
                byDestination[destination, default: []].append(link)
            } else {
                noGroup.append(link)
            }
        }

        return (byDestination, noGroup)
    }

    private var noGroupSection: LinkSection {
        LinkSection(
            id: "no-group", title: Self.noGroupTitle, sortIndex: 0,
            destination: nil, links: groupedLinks.noGroup
        )
    }

    private var windowSections: [WindowSection] {
        let linksByDestination = groupedLinks.byDestination
        var seenGroups = Set<String>()
        var claimedDestinations = Set<String>()
        var groupsByWindow: [Int: [LinkSection]] = [:]

        for group in browserGroups {
            guard let title = normalizedDestination(group.title) else { continue }
            let groupKey = "\(group.windowID):\(title)"
            guard seenGroups.insert(groupKey).inserted else { continue }
            let isDestinationOwner = claimedDestinations.insert(title).inserted
            groupsByWindow[group.windowID, default: []].append(
                LinkSection(
                    id: "window:\(group.windowID):group:\(title)",
                    title: title,
                    sortIndex: group.index,
                    destination: title,
                    links: isDestinationOwner ? linksByDestination[title] ?? [] : []
                )
            )
        }

        var windows = groupsByWindow.keys.sorted().map { windowID in
            WindowSection(
                id: "window:\(windowID)",
                title: "Tab Groups",
                groups: (groupsByWindow[windowID] ?? []).sorted {
                    $0.sortIndex == $1.sortIndex
                        ? $0.title.localizedStandardCompare($1.title) == .orderedAscending
                        : $0.sortIndex < $1.sortIndex
                }
            )
        }

        let unknownDestinations = linksByDestination.keys.filter { !claimedDestinations.contains($0) }.sorted {
            $0.localizedStandardCompare($1) == .orderedAscending
        }
        if !unknownDestinations.isEmpty {
            windows.append(
                WindowSection(
                    id: "window:unknown",
                    title: "Other groups",
                    groups: unknownDestinations.map { title in
                        LinkSection(
                            id: "window:unknown:group:\(title)",
                            title: title,
                            sortIndex: .max,
                            destination: title,
                            links: linksByDestination[title] ?? []
                        )
                    }
                )
            )
        }

        return windows
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

    private func delete(linkID: String) {
        guard let index = links.firstIndex(where: { $0.id == linkID }) else { return }
        let deletedLink = links.remove(at: index)

        Task {
            do {
                try await PocketBaseClient.deleteSharedLink(id: linkID)
            } catch {
                guard !links.contains(where: { $0.id == linkID }) else { return }
                links.insert(deletedLink, at: min(index, links.count))
                deleteErrorMessage = error.localizedDescription
            }
        }
    }

    private func retryLoad() {
        if links.isEmpty {
            isLoading = true
        }
        errorMessage = nil
        Task { await load() }
    }

    private func load() async {
        guard let serverURL = SharedStore.serverURL, let token = SharedStore.authToken else {
            isLoading = false
            errorMessage = PocketBaseError.notConfigured.localizedDescription
            return
        }

        async let browserGroupsTask = PocketBaseClient.fetchBrowserGroups(serverURL: serverURL, token: token)
        do {
            let fetchedLinks = try await PocketBaseClient.fetchSharedLinks()
            let fetchedBrowserGroups = await browserGroupsTask
            links = fetchedLinks
            browserGroups = fetchedBrowserGroups
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

private struct WindowGroupDisclosure: View {
    let window: LinksView.WindowSection
    @Binding var dragContext: LinkDragContext?
    let onDrop: (_ linkID: String, _ destination: String?) -> Void
    let onDelete: (_ linkID: String) -> Void

    @State private var isExpanded = true

    var body: some View {
        DisclosureGroup(isExpanded: $isExpanded) {
            LazyVStack(alignment: .leading, spacing: 10) {
                ForEach(window.groups) { group in
                    TabGroupDisclosure(
                        group: group,
                        dragContext: $dragContext,
                        onDrop: onDrop,
                        onDelete: onDelete
                    )
                }
            }
            .padding(.top, 10)
            .padding(.leading, 8)
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "macwindow")
                    .foregroundStyle(.secondary)
                Text(window.title)
                    .font(.headline)
            }
        }
        .tint(.primary)
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color(uiColor: .secondarySystemGroupedBackground))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(Color(uiColor: .separator).opacity(0.45), lineWidth: 1)
        )
    }
}

private struct TabGroupDisclosure: View {
    let group: LinksView.LinkSection
    @Binding var dragContext: LinkDragContext?
    let onDrop: (_ linkID: String, _ destination: String?) -> Void
    let onDelete: (_ linkID: String) -> Void

    @State private var isExpanded = false
    @State private var isTargeted = false

    var body: some View {
        DisclosureGroup(isExpanded: $isExpanded) {
            GroupDropTarget(
                sectionID: group.id,
                destination: group.destination,
                links: group.links,
                dragContext: $dragContext,
                onDrop: onDrop,
                onDelete: onDelete
            )
            .padding(.top, 8)
        } label: {
            HStack {
                Text(group.title)
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Text("\(group.links.count)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            .padding(.vertical, 6)
            .padding(.horizontal, 8)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(isTargeted ? Color.accentColor.opacity(0.12) : Color.clear)
            )
            .contentShape(Rectangle())
            .onDrop(
                of: [.plainText],
                delegate: LinkDropDelegate(
                    sectionID: group.id,
                    destination: group.destination,
                    dragContext: $dragContext,
                    isTargeted: $isTargeted,
                    onDrop: onDrop
                )
            )
        }
        .tint(.secondary)
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
    let onDelete: (_ linkID: String) -> Void

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

                    SwipeToDeleteLinkRow(link: link, onDelete: onDelete)
                        .contentShape(Rectangle())
                        .accessibilityHint("Swipe left to delete, or drag to move this link")
                        .onDrag {
                            dragContext = LinkDragContext(linkID: link.id, sourceSectionID: sectionID)
                            return NSItemProvider(object: link.id as NSString)
                        }
                }
            }
        }
    }
}

private struct SwipeToDeleteLinkRow: View {
    let link: SharedLink
    let onDelete: (_ linkID: String) -> Void

    @State private var offset: CGFloat = 0
    @State private var dragStartOffset: CGFloat = 0

    private let actionWidth: CGFloat = 76

    var body: some View {
        ZStack(alignment: .trailing) {
            Button(role: .destructive) {
                onDelete(link.id)
            } label: {
                VStack(spacing: 4) {
                    Image(systemName: "trash")
                    Text("Delete")
                        .font(.caption)
                }
                .foregroundStyle(.white)
                .frame(width: actionWidth)
                .frame(maxHeight: .infinity)
            }
            .buttonStyle(.plain)
            .background(Color.red)

            LinkRow(link: link)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(uiColor: .secondarySystemGroupedBackground))
                .offset(x: offset)
                .gesture(swipeGesture)
                .onTapGesture {
                    guard offset != 0 else { return }
                    settle(at: 0)
                }
        }
        .clipped()
        .accessibilityAction(named: "Delete") {
            onDelete(link.id)
        }
    }

    private var swipeGesture: some Gesture {
        DragGesture(minimumDistance: 18)
            .onChanged { value in
                guard abs(value.translation.width) > abs(value.translation.height) else { return }
                offset = min(0, max(-actionWidth, dragStartOffset + value.translation.width))
            }
            .onEnded { value in
                guard abs(value.translation.width) > abs(value.translation.height) else { return }
                if value.predictedEndTranslation.width < -actionWidth * 1.6 {
                    onDelete(link.id)
                } else {
                    settle(at: offset < -actionWidth / 2 ? -actionWidth : 0)
                }
            }
    }

    private func settle(at target: CGFloat) {
        withAnimation(.easeOut(duration: 0.18)) {
            offset = target
            dragStartOffset = target
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
