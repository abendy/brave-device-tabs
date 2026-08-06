import SwiftUI

struct ShareComposeView: View {
    @ObservedObject var model: ShareComposeModel
    @FocusState private var isGroupNameFocused: Bool

    var body: some View {
        NavigationStack {
            Form {
                if let url = model.sharedURL {
                    Section {
                        Text(url.absoluteString)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                }

                if !model.isConfigured {
                    Section {
                        Text("Open the Device Tabs Share app and sign in first.")
                            .foregroundStyle(.secondary)
                    }
                } else if model.isSessionExpired {
                    Section {
                        Text("Session expired — open the Device Tabs Share app and sign in again.")
                            .foregroundStyle(.secondary)
                    }
                } else {
                    Section {
                        destinationRow(
                            title: "No group",
                            destination: .none,
                            showsColorDot: false,
                            usesAccentColor: true
                        )
                        destinationRow(
                            title: "New group…",
                            destination: .new(windowID: nil),
                            showsColorDot: false,
                            usesAccentColor: true
                        )
                        if case .new(let windowID) = model.selectedDestination, windowID == nil {
                            TextField("Group name", text: $model.newGroupName)
                                .focused($isGroupNameFocused)
                        }
                    }

                    if !model.pendingGroups.isEmpty {
                        Section("Not in the browser yet") {
                            ForEach(model.pendingGroups, id: \.self) { option in
                                destinationRow(
                                    title: option.title,
                                    destination: .existing(
                                        title: option.title, windowID: option.windowID
                                    ),
                                    colorName: nil
                                )
                            }
                        }
                    }

                    ForEach(model.windowGroups, id: \.windowID) { cluster in
                        Section("Window") {
                            ForEach(cluster.groups, id: \.self) { group in
                                destinationRow(
                                    title: group.title,
                                    destination: .existing(
                                        title: group.title, windowID: cluster.windowID
                                    ),
                                    colorName: group.color
                                )
                            }
                            destinationRow(
                                title: "New group here…",
                                destination: .new(windowID: cluster.windowID),
                                showsColorDot: false,
                                usesAccentColor: true
                            )
                            if case .new(let windowID) = model.selectedDestination,
                               windowID == cluster.windowID {
                                TextField("Group name", text: $model.newGroupName)
                                    .focused($isGroupNameFocused)
                            }
                        }
                    }
                }

                Section {
                    Text("\(DeploymentMarker.word) deployment")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
            .navigationTitle("Save to Device Tabs")
            .navigationBarTitleDisplayMode(.inline)
            .onChange(of: model.selectedDestination) { _, newDestination in
                if case .new = newDestination {
                    Task { @MainActor in
                        isGroupNameFocused = true
                    }
                } else {
                    isGroupNameFocused = false
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: model.cancel)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if model.isPosting {
                        ProgressView()
                    } else {
                        Button("Post", action: model.post)
                            .disabled(
                                !model.isConfigured || model.isSessionExpired
                                    || model.sharedURL == nil || model.isNewGroupNameMissing
                            )
                    }
                }
            }
            .alert(
                "Couldn't save link",
                isPresented: Binding(
                    get: { model.saveErrorMessage != nil },
                    set: { if !$0 { model.saveErrorMessage = nil } }
                )
            ) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(model.saveErrorMessage ?? "The link could not be saved.")
            }
        }
    }

    private func destinationRow(
        title: String,
        destination: ShareComposeModel.Destination,
        colorName: String? = nil,
        showsColorDot: Bool = true,
        usesAccentColor: Bool = false
    ) -> some View {
        Button {
            model.selectedDestination = destination
        } label: {
            HStack(spacing: 12) {
                if showsColorDot {
                    GroupColorDot(colorName: colorName)
                }
                Text(title)
                    .foregroundStyle(usesAccentColor ? Color.accentColor : Color.primary)
                Spacer()
                if model.selectedDestination == destination {
                    Image(systemName: "checkmark")
                        .foregroundStyle(Color.accentColor)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
