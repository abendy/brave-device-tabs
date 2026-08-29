import SwiftUI
import UniformTypeIdentifiers

/// Links is the default screen once signed in; the settings/login form from
/// before (`ContentView`) is reused as-is for the initial sign-in and,
/// afterward, as a sheet reachable from Links' toolbar.
///
/// iOS forbids reacting to a copy in the background, so clipboard quick-save
/// is the standard foreground approximation: whenever the app comes forward
/// with a fresh clipboard that probably holds a link (checked via the
/// banner-free detection APIs), a capsule offers one tap into the same
/// compose sheet the share extension uses. The clipboard is only actually
/// read — which shows the system paste notice — after that tap.
struct RootView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var isSignedIn = SharedStore.isConfigured
    @State private var showSettings = false
    @State private var isQuickSaveOffered = false
    @State private var showQuickSave = false
    @State private var quickSaveModel: ShareComposeModel?

    var body: some View {
        if isSignedIn {
            LinksView(
                onOpenSettings: { showSettings = true },
                onSessionExpired: {
                    // Keep the server URL so the sign-in form comes back
                    // prefilled; only the dead token is discarded.
                    SharedStore.authToken = nil
                    isSignedIn = false
                }
            )
                .sheet(isPresented: $showSettings) {
                    ContentView(onSignedOut: {
                        isSignedIn = false
                        showSettings = false
                    })
                }
                .safeAreaInset(edge: .bottom) {
                    if isQuickSaveOffered {
                        quickSaveOffer
                    }
                }
                .sheet(isPresented: $showQuickSave, onDismiss: dismissQuickSaveOffer) {
                    if let quickSaveModel {
                        ShareComposeView(model: quickSaveModel)
                    }
                }
                .onAppear(perform: checkClipboard)
                .onChange(of: scenePhase) { _, newPhase in
                    guard newPhase == .active else { return }
                    checkClipboard()
                }
        } else {
            ContentView(onSignedIn: { isSignedIn = true })
        }
    }

    private var quickSaveOffer: some View {
        HStack(spacing: 10) {
            Button(action: openQuickSave) {
                Label("Save copied link…", systemImage: "doc.on.clipboard")
                    .font(.subheadline.weight(.semibold))
            }
            Button(action: dismissQuickSaveOffer) {
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(.secondary)
            }
            .accessibilityLabel("Dismiss quick save")
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 16)
        .background(Capsule().fill(.regularMaterial))
        .overlay(Capsule().stroke(Color(uiColor: .separator).opacity(0.45), lineWidth: 1))
        .padding(.bottom, 8)
    }

    /// Banner-free probe: `hasURLs` and `detectedPatterns` inspect metadata
    /// without reading the clipboard, so no paste notice appears until the
    /// user accepts the offer.
    private func checkClipboard() {
        let pasteboard = UIPasteboard.general
        guard pasteboard.changeCount != SharedStore.lastQuickSaveChangeCount else {
            isQuickSaveOffered = false
            return
        }
        if pasteboard.hasURLs {
            isQuickSaveOffered = true
            return
        }
        guard pasteboard.hasStrings else {
            isQuickSaveOffered = false
            return
        }
        Task {
            let patterns = (try? await pasteboard.detectedPatterns(for: [\.probableWebURL])) ?? []
            await MainActor.run {
                isQuickSaveOffered = patterns.contains(\.probableWebURL)
            }
        }
    }

    private func openQuickSave() {
        let pasteboard = UIPasteboard.general
        let changeCount = pasteboard.changeCount
        guard let url = pasteboard.url ?? pasteboard.string.flatMap(Self.firstURL(in:)) else {
            dismissQuickSaveOffer()
            return
        }

        let model = ShareComposeModel()
        model.sharedURL = url
        model.onComplete = {
            SharedStore.lastQuickSaveChangeCount = changeCount
            showQuickSave = false
            isQuickSaveOffered = false
        }
        model.onCancel = {
            SharedStore.lastQuickSaveChangeCount = changeCount
            showQuickSave = false
            isQuickSaveOffered = false
        }
        model.loadDestinations()
        model.checkForDuplicate()
        quickSaveModel = model
        showQuickSave = true
    }

    /// A swipe-down or explicit dismissal also marks the clipboard handled,
    /// so the offer doesn't nag about the same copy.
    private func dismissQuickSaveOffer() {
        SharedStore.lastQuickSaveChangeCount = UIPasteboard.general.changeCount
        isQuickSaveOffered = false
    }

    private static func firstURL(in text: String) -> URL? {
        guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else {
            return URL(string: text)
        }
        let range = NSRange(text.startIndex..., in: text)
        return detector.firstMatch(in: text, range: range)?.url
    }
}
