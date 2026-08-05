import SwiftUI
import UniformTypeIdentifiers

/// Shows shared links grouped by their destination tab group, with drag and
/// drop to move a link between groups. Every known group renders even when it
/// has no links so there is always somewhere to drop.
struct LinksView: View {
    var onOpenSettings: () -> Void
    var onSessionExpired: () -> Void

    @Environment(\.scenePhase) private var scenePhase
    @State private var links: [SharedLink] = []
    @State private var browserGroups: [BrowserGroup] = []
    @State private var isLoading = true
    @State private var isSessionExpired = false
    @State private var errorMessage: String?
    @State private var hasCompletedInitialLoad = false
    @State private var dragContext: LinkDragContext?
    @State private var moveErrorMessage: String?
    @State private var deleteErrorMessage: String?
    @State private var stagedLinkIDs: Set<String> = []
    @State private var newGroupName: String = ""
    @State private var loadCoordinator = LinksLoadCoordinator()
    @State private var collapsedWindowIDs: Set<String> = Set(
        UserDefaults.standard.stringArray(forKey: LinksView.collapsedWindowsKey) ?? []
    )

    private static let noGroupTitle = "No group"
    private static let newGroupSectionID = "new-group"
    private static let collapsedWindowsKey = "collapsedLinkWindows"

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
        if isSessionExpired {
            VStack(spacing: 12) {
                Image(systemName: "person.crop.circle.badge.exclamationmark")
                    .font(.largeTitle)
                    .foregroundStyle(.secondary)
                Text("Session expired")
                    .font(.headline)
                Text("Sign in again to keep sharing links between your devices.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                Button("Sign In Again", action: onSessionExpired)
            }
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if isLoading && links.isEmpty && browserGroups.isEmpty && errorMessage == nil {
            ProgressView("Loading links…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let errorMessage, links.isEmpty && browserGroups.isEmpty {
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
                            destinationWindowID: noGroupSection.destinationWindowID,
                            links: noGroupSection.links,
                            dragContext: $dragContext,
                            onDrop: move,
                            onDelete: delete
                        )
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Text("New Group")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .textCase(.uppercase)
                            .padding(.horizontal, 4)

                        NewGroupDropTarget(
                            sectionID: Self.newGroupSectionID,
                            stagedLinks: stagedLinks,
                            dragContext: $dragContext,
                            groupName: $newGroupName,
                            onStage: stage,
                            onUnstage: unstage,
                            onSave: saveNewGroup
                        )
                    }

                    ForEach(windowSections) { window in
                        WindowGroupDisclosure(
                            window: window,
                            isExpanded: isExpandedBinding(for: window.id),
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
                    get: { errorMessage != nil && (!links.isEmpty || !browserGroups.isEmpty) },
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
        /// Chrome color name of the live group; nil for iOS-created groups.
        let color: String?
        /// nil clears the link's destination; matches `move(linkID:to:windowID:)`.
        let destination: String?
        /// Window the destination targets; nil for No group and Other groups.
        let destinationWindowID: Int?
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

    private struct DestinationBucket {
        var displayTitle: String
        var links: [SharedLink]
    }

    /// Links staged into the New Group card render only there, not in their
    /// old section, until they're saved (or unstaged). Buckets are keyed by
    /// lowercased title so differently-cased destinations merge — matching
    /// how the extension resolves them — with the first link's casing kept
    /// for display.
    private var groupedLinks: (byDestination: [String: DestinationBucket], noGroup: [SharedLink]) {
        var byDestination: [String: DestinationBucket] = [:]
        var noGroup: [SharedLink] = []
        for link in links where !stagedLinkIDs.contains(link.id) {
            if let destination = normalizedDestination(link.destination) {
                let key = destination.localizedLowercase
                var bucket = byDestination[key] ?? DestinationBucket(displayTitle: destination, links: [])
                bucket.links.append(link)
                byDestination[key] = bucket
            } else {
                noGroup.append(link)
            }
        }

        return (byDestination, noGroup)
    }

    private var stagedLinks: [SharedLink] {
        links.filter { stagedLinkIDs.contains($0.id) }
    }

    private var noGroupSection: LinkSection {
        LinkSection(
            id: "no-group", title: Self.noGroupTitle, sortIndex: 0, color: nil,
            destination: nil, destinationWindowID: nil, links: groupedLinks.noGroup
        )
    }

    private var windowSections: [WindowSection] {
        let buckets = groupedLinks.byDestination
        var seenGroups = Set<String>()
        var slots: [(windowID: Int, title: String, key: String, sortIndex: Int, color: String?)] = []
        var windowsByTitle: [String: [Int]] = [:]

        for group in browserGroups {
            guard let title = normalizedDestination(group.title) else { continue }
            let key = title.localizedLowercase
            guard seenGroups.insert("\(group.windowID):\(key)").inserted else { continue }
            slots.append((group.windowID, title, key, group.index, group.color))
            windowsByTitle[key, default: []].append(group.windowID)
        }

        // A link carrying a window id lands in that window's copy of its
        // group when it is live, so same-titled groups in two windows each
        // show their own links. Windowless (or stale-window) links go to the
        // title's first-encountered window, as before.
        var linksBySlot: [String: [SharedLink]] = [:]
        var unknownBuckets: [DestinationBucket] = []
        for (key, bucket) in buckets {
            guard let windows = windowsByTitle[key] else {
                unknownBuckets.append(bucket)
                continue
            }
            for link in bucket.links {
                let windowID: Int
                if let linkWindow = link.destinationWindowID, windows.contains(linkWindow) {
                    windowID = linkWindow
                } else {
                    windowID = windows[0]
                }
                linksBySlot["\(windowID):\(key)", default: []].append(link)
            }
        }

        var groupsByWindow: [Int: [LinkSection]] = [:]
        for slot in slots {
            groupsByWindow[slot.windowID, default: []].append(
                LinkSection(
                    id: "window:\(slot.windowID):group:\(slot.key)",
                    title: slot.title,
                    sortIndex: slot.sortIndex,
                    color: slot.color,
                    destination: slot.title,
                    destinationWindowID: slot.windowID,
                    links: linksBySlot["\(slot.windowID):\(slot.key)"] ?? []
                )
            )
        }

        var windows: [WindowSection] = []

        let unknown = unknownBuckets.sorted {
            $0.displayTitle.localizedStandardCompare($1.displayTitle) == .orderedAscending
        }
        if !unknown.isEmpty {
            windows.append(
                WindowSection(
                    id: "window:unknown",
                    title: "Other groups",
                    groups: unknown.map { bucket in
                        LinkSection(
                            id: "window:unknown:group:\(bucket.displayTitle.localizedLowercase)",
                            title: bucket.displayTitle,
                            sortIndex: .max,
                            color: nil,
                            destination: bucket.displayTitle,
                            destinationWindowID: nil,
                            links: bucket.links
                        )
                    }
                )
            )
        }

        windows += groupsByWindow.keys.sorted().map { windowID in
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

        return windows
    }

    private func move(linkID: String, to destination: String?, windowID: Int?) {
        guard let index = links.firstIndex(where: { $0.id == linkID }) else { return }
        let link = links[index]
        let sameTitle = normalizedDestination(link.destination)?.localizedLowercase
            == normalizedDestination(destination)?.localizedLowercase
        guard !(sameTitle && link.destinationWindowID == windowID) else { return }

        let previousDestination = link.destination
        let previousWindowID = link.destinationWindowID
        links[index] = SharedLink(
            id: link.id, url: link.url, title: link.title, source: link.source,
            destination: destination, destinationWindowID: windowID
        )

        Task {
            do {
                try await PocketBaseClient.updateLinkDestination(
                    id: linkID, destination: destination, windowID: windowID
                )
            } catch {
                if let rollbackIndex = links.firstIndex(where: { $0.id == linkID }) {
                    let current = links[rollbackIndex]
                    links[rollbackIndex] = SharedLink(
                        id: current.id, url: current.url, title: current.title, source: current.source,
                        destination: previousDestination, destinationWindowID: previousWindowID
                    )
                }
                moveErrorMessage = error.localizedDescription
            }
        }
    }

    private func stage(linkID: String) {
        stagedLinkIDs.insert(linkID)
    }

    private func unstage(linkID: String) {
        stagedLinkIDs.remove(linkID)
    }

    private func saveNewGroup() {
        let trimmedName = newGroupName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else { return }

        for linkID in stagedLinkIDs {
            move(linkID: linkID, to: trimmedName, windowID: nil)
        }
        stagedLinkIDs.removeAll()
        newGroupName = ""
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

    /// Collapse state survives relaunches; window ids are ephemeral across
    /// browser restarts, so stale entries simply stop matching and the
    /// replacement window starts expanded (the default).
    private func isExpandedBinding(for windowID: String) -> Binding<Bool> {
        Binding(
            get: { !collapsedWindowIDs.contains(windowID) },
            set: { expanded in
                if expanded {
                    collapsedWindowIDs.remove(windowID)
                } else {
                    collapsedWindowIDs.insert(windowID)
                }
                UserDefaults.standard.set(
                    Array(collapsedWindowIDs).sorted(), forKey: Self.collapsedWindowsKey
                )
            }
        )
    }

    private func retryLoad() {
        if links.isEmpty {
            isLoading = true
        }
        errorMessage = nil
        Task { await load() }
    }

    private func load() async {
        let generation = loadCoordinator.beginLoad()
        guard SharedStore.isConfigured else {
            guard loadCoordinator.isCurrent(generation) else { return }
            isLoading = false
            errorMessage = PocketBaseError.notConfigured.localizedDescription
            return
        }

        // A dead token makes both list fetches below "succeed" with empty
        // data (SYNC_REVIEW.md finding #10), so the session is validated —
        // and rotated — before anything is fetched or committed.
        let session = await PocketBaseClient.refreshSession()
        guard loadCoordinator.isCurrent(generation) else { return }
        if session == .expired {
            isSessionExpired = true
            isLoading = false
            return
        }
        guard let serverURL = SharedStore.serverURL, let token = SharedStore.authToken else {
            isLoading = false
            errorMessage = PocketBaseError.notConfigured.localizedDescription
            return
        }

        async let linksTask: Result<[SharedLink], Error> = {
            do {
                return .success(try await PocketBaseClient.fetchSharedLinks())
            } catch {
                return .failure(error)
            }
        }()
        async let browserGroupsTask: Result<[BrowserGroup], Error> = {
            do {
                return .success(
                    try await PocketBaseClient.fetchBrowserGroups(serverURL: serverURL, token: token)
                )
            } catch {
                return .failure(error)
            }
        }()
        let (linksResult, browserGroupsResult) = await (linksTask, browserGroupsTask)

        guard loadCoordinator.isCurrent(generation) else { return }

        var nextErrorMessage: String?
        switch linksResult {
        case .success(let fetchedLinks):
            links = fetchedLinks
        case .failure(let error):
            nextErrorMessage = error.localizedDescription
        }
        switch browserGroupsResult {
        case .success(let fetchedBrowserGroups):
            browserGroups = fetchedBrowserGroups
        case .failure(let error):
            let groupError = "Tab groups could not be refreshed; existing group data may be stale. \(error.localizedDescription)"
            nextErrorMessage = nextErrorMessage.map { "\($0) \(groupError)" } ?? groupError
        }
        errorMessage = nextErrorMessage
        isLoading = false
    }
}

/// Approximates Chrome's tab-group palette with system colors so the dots
/// track light/dark mode; nil for unknown names or iOS-created groups.
private func chromeGroupColor(_ name: String?) -> Color? {
    switch name {
    case "grey": return Color(uiColor: .systemGray)
    case "blue": return .blue
    case "red": return .red
    case "yellow": return .yellow
    case "green": return .green
    case "pink": return .pink
    case "purple": return .purple
    case "cyan": return .cyan
    case "orange": return .orange
    default: return nil
    }
}

/// Chrome-style group color indicator: filled with the live group's color,
/// hollow for iOS-created groups that have no live tab group yet.
private struct GroupColorDot: View {
    let colorName: String?

    var body: some View {
        if let color = chromeGroupColor(colorName) {
            Circle()
                .fill(color)
                .frame(width: 10, height: 10)
        } else {
            Circle()
                .strokeBorder(Color(uiColor: .separator), lineWidth: 1.5)
                .frame(width: 10, height: 10)
        }
    }
}

/// Kept as non-observable reference state so starting a refresh does not
/// invalidate the view and cancel SwiftUI's `.refreshable` task.
private final class LinksLoadCoordinator {
    private var generation = 0

    func beginLoad() -> Int {
        generation += 1
        return generation
    }

    func isCurrent(_ candidate: Int) -> Bool {
        candidate == generation
    }
}

private struct WindowGroupDisclosure: View {
    let window: LinksView.WindowSection
    @Binding var isExpanded: Bool
    @Binding var dragContext: LinkDragContext?
    let onDrop: (_ linkID: String, _ destination: String?, _ windowID: Int?) -> Void
    let onDelete: (_ linkID: String) -> Void

    private static let previewCount = 3

    private var collapsedPreview: String {
        let titles = window.groups.map(\.title)
        let shown = titles.prefix(Self.previewCount).joined(separator: ", ")
        let remaining = titles.count - Self.previewCount
        return remaining > 0 ? "\(shown) +\(remaining)" : shown
    }

    private var totalLinkCount: Int {
        window.groups.reduce(0) { $0 + $1.links.count }
    }

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
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 8) {
                    Image(systemName: "macwindow")
                        .foregroundStyle(.secondary)
                    Text(window.title)
                        .font(.headline)
                    if !isExpanded {
                        Spacer()
                        Text("\(totalLinkCount)")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }
                if !isExpanded && !collapsedPreview.isEmpty {
                    Text(collapsedPreview)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
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
    let onDrop: (_ linkID: String, _ destination: String?, _ windowID: Int?) -> Void
    let onDelete: (_ linkID: String) -> Void

    @State private var isExpanded = false
    @State private var isTargeted = false

    var body: some View {
        DisclosureGroup(isExpanded: $isExpanded) {
            GroupDropTarget(
                sectionID: group.id,
                destination: group.destination,
                destinationWindowID: group.destinationWindowID,
                links: group.links,
                dragContext: $dragContext,
                onDrop: onDrop,
                onDelete: onDelete
            )
            .padding(.top, 8)
        } label: {
            HStack(spacing: 8) {
                GroupColorDot(colorName: group.color)
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
                    destinationWindowID: group.destinationWindowID,
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
    let destinationWindowID: Int?
    let links: [SharedLink]
    @Binding var dragContext: LinkDragContext?
    let onDrop: (_ linkID: String, _ destination: String?, _ windowID: Int?) -> Void
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
                destinationWindowID: destinationWindowID,
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

/// Mirrors `GroupDropTarget`'s drop-ready card, but a drop here stages the
/// link locally instead of committing a PocketBase move immediately: the
/// group name isn't known yet, so nothing is written to the server until
/// Save is tapped.
private struct NewGroupDropTarget: View {
    let sectionID: String
    let stagedLinks: [SharedLink]
    @Binding var dragContext: LinkDragContext?
    @Binding var groupName: String
    let onStage: (_ linkID: String) -> Void
    let onUnstage: (_ linkID: String) -> Void
    let onSave: () -> Void

    @State private var isTargeted = false

    private var trimmedName: String {
        groupName.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if !stagedLinks.isEmpty {
                HStack(spacing: 8) {
                    TextField("Group name", text: $groupName)
                        .textFieldStyle(.roundedBorder)
                    Button("Save", action: onSave)
                        .disabled(trimmedName.isEmpty)
                }
                .padding(12)
            }

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
        }
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
                destination: nil,
                destinationWindowID: nil,
                dragContext: $dragContext,
                isTargeted: $isTargeted,
                onDrop: { linkID, _, _ in onStage(linkID) }
            )
        )
    }

    @ViewBuilder
    private var rows: some View {
        if stagedLinks.isEmpty {
            Text("Drag a link here")
                .font(.footnote)
                .foregroundStyle(.tertiary)
                .frame(maxWidth: .infinity, minHeight: 72, alignment: .leading)
                .padding(.horizontal, 16)
        } else {
            VStack(spacing: 0) {
                ForEach(stagedLinks) { link in
                    if link.id != stagedLinks.first?.id {
                        Divider()
                            .padding(.leading, 16)
                    }

                    HStack(spacing: 8) {
                        LinkRow(link: link)
                        Spacer(minLength: 8)
                        Button {
                            onUnstage(link.id)
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(.secondary)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Remove from New Group")
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
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
    let destinationWindowID: Int?
    @Binding var dragContext: LinkDragContext?
    @Binding var isTargeted: Bool
    let onDrop: (_ linkID: String, _ destination: String?, _ windowID: Int?) -> Void

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
        onDrop(dragContext.linkID, destination, destinationWindowID)
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
