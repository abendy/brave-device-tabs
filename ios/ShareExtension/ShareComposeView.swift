import SwiftUI

struct ShareComposeView: View {
    @ObservedObject var model: ShareComposeModel

    var body: some View {
        NavigationStack {
            Form {
                if !model.isConfigured {
                    Section {
                        Text("Open the Device Tabs Share app and sign in first.")
                            .foregroundStyle(.secondary)
                    }
                } else {
                    Section("Note") {
                        TextField("Optional note", text: $model.noteText, axis: .vertical)
                    }

                    Section("Destination") {
                        Picker(selection: $model.selectedGroup) {
                            Text("No group").tag(String?.none)
                            ForEach(model.availableGroups, id: \.self) { group in
                                Text(group).tag(String?.some(group))
                            }
                        } label: {
                            Text("Destination")
                        }
                        .pickerStyle(.menu)
                    }
                }

                if let url = model.sharedURL {
                    Section("Link") {
                        Text(url.absoluteString)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
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
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: model.cancel)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if model.isPosting {
                        ProgressView()
                    } else {
                        Button("Post", action: model.post)
                            .disabled(!model.isConfigured || model.sharedURL == nil)
                    }
                }
            }
        }
    }
}
