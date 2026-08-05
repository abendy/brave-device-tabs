import SwiftUI

/// Links is the default screen once signed in; the settings/login form from
/// before (`ContentView`) is reused as-is for the initial sign-in and,
/// afterward, as a sheet reachable from Links' toolbar.
struct RootView: View {
    @State private var isSignedIn = SharedStore.isConfigured
    @State private var showSettings = false

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
        } else {
            ContentView(onSignedIn: { isSignedIn = true })
        }
    }
}
