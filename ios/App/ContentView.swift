import SwiftUI

struct ContentView: View {
    var onSignedIn: (() -> Void)?
    var onSignedOut: (() -> Void)?

    @State private var serverURLText: String = SharedStore.serverURL?.absoluteString ?? ""
    @State private var email: String = ""
    @State private var password: String = ""
    @State private var isSignedIn: Bool = SharedStore.isConfigured
    @State private var isWorking = false
    @State private var statusMessage: String?
    @State private var statusIsError = false

    var body: some View {
        NavigationStack {
            Form {
                Section("PocketBase server") {
                    TextField("Server URL, e.g. https://your-app.fly.dev", text: $serverURLText)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .disabled(isSignedIn)
                }

                if isSignedIn {
                    Section {
                        Label("Signed in — sharing is active", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                        Button("Sign Out", role: .destructive, action: signOut)
                    }
                } else {
                    Section("Account") {
                        TextField("Email", text: $email)
                            .keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        SecureField("Password", text: $password)
                    }

                    Section {
                        Button {
                            Task { await signIn() }
                        } label: {
                            if isWorking {
                                ProgressView()
                            } else {
                                Text("Sign In")
                            }
                        }
                        .disabled(isWorking || serverURLText.isEmpty || email.isEmpty || password.isEmpty)
                    }
                }

                if let statusMessage {
                    Section {
                        Text(statusMessage)
                            .foregroundStyle(statusIsError ? .red : .secondary)
                    }
                }

                Section {
                    Text("\(DeploymentMarker.word) deployment")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }
            .navigationTitle("Device Tabs Share")
        }
    }

    private func signIn() async {
        guard let url = URL(string: serverURLText) else {
            statusIsError = true
            statusMessage = "Enter a valid server URL."
            return
        }

        isWorking = true
        statusMessage = nil
        defer { isWorking = false }

        do {
            let token = try await PocketBaseClient.login(serverURL: url, email: email, password: password)
            SharedStore.serverURL = url
            SharedStore.authToken = token
            isSignedIn = true
            password = ""
            onSignedIn?()
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
        }
    }

    private func signOut() {
        SharedStore.serverURL = nil
        SharedStore.authToken = nil
        isSignedIn = false
        onSignedOut?()
    }
}
