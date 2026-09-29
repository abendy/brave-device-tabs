# iOS debugging notes

What's specific to debugging this app and its share extension.

## Sign-in state lives in the App Group

The container app and the share extension share sign-in state through the
App Group `group.com.abendy.devicetabs`. If the share sheet says "Open the
app and sign in first", check that state before touching any code.

**Overwrite-install vs. uninstall-then-install matters.** `simctl install` /
`devicectl device install app` over an existing install preserves app data,
including the shared App Group container both targets read sign-in state
from. A full `simctl uninstall` / `devicectl device uninstall app` wipes that
— useful when you specifically want to rule out stale state, but it also
means you'll need to sign in again afterward. Default to overwrite-install;
only uninstall first when you're actively trying to rule out cached state as
a cause.

Simulator's "Sign to Run Locally" identity strips App-ID-bound entitlements
like App Groups from the signed binary, even when the source `.entitlements`
file and build settings are correct. Sharing still works on Simulator, so
this isn't a bug there; it only matters where the entitlement must be
genuinely enforced, which means a real device.

## Stream simulator logs by tag

Add distinctive `NSLog("[SOME-TAG] ...")` calls at suspect points in the
Swift code and filter on the tag; this is more reliable than trying to infer
behavior from stock system log noise.

```sh
xcrun simctl spawn <device-id> log stream --level debug --predicate 'process == "ShareExtension"'
xcrun simctl spawn <device-id> log stream --level debug --predicate 'eventMessage CONTAINS "DTS-DEBUG"'
```

Run this *before* triggering the action you want to observe (it's a live
tail, not a history query) — launch it in the background, do the action on
device, then read the captured output.

This only works for simulators. When a bug only reproduces on a real device,
the fallback is adding `NSLog`/`print` debug statements and reasoning from
behavior, or temporarily reproducing on the simulator if the bug isn't
simulator-specific.

## Known gotchas (found the hard way)

- **`SLComposeServiceViewController`'s `configurationItems()` can be a dead
  end.** The share extension originally used it to show a "Destination"
  picker row. `configurationItems()` was confirmed (via `NSLog` + log
  streaming) to be called correctly and to construct/return a valid
  `SLComposeSheetConfigurationItem` every time — but the row never rendered,
  on both Simulator and a real device, and neither switching to a
  storyboard-based extension (`NSExtensionMainStoryboard` instead of
  `NSExtensionPrincipalClass`) nor any configuration-item property fixed it.
  The actual fix was dropping `SLComposeServiceViewController` entirely: the
  share extension is now a plain `UIViewController` (`ShareViewController`)
  hosting a SwiftUI view (`ShareComposeView`) via `UIHostingController`, with
  its own Form, Picker, and Cancel/Post toolbar built from scratch. If a
  share extension needs custom UI beyond a single text field, building it
  this way from the start would have saved a lot of round-trips.
- **Mutating `@State` before the first `await` inside a `.refreshable`
  closure can cancel the refresh itself.** `LinksView`'s `load()` used to set
  `isLoading = true` synchronously before fetching. Even though that state
  change didn't visibly switch which branch of the view's `@ViewBuilder`
  conditional rendered (the list was already non-empty, so it stayed on the
  `ScrollView` case), the resulting body re-evaluation still cancelled
  `.refreshable`'s in-flight task — confirmed via tagged `NSLog` output
  showing the fetch start and then a `CancellationError` within ~13ms of the
  pull gesture. This was invisible in the UI because the error branch only
  rendered when `links.isEmpty`, so a cancelled refresh just looked like
  pull-to-refresh silently doing nothing — easy to misdiagnose as a caching
  or networking problem instead (server freshness, auth, and scene-phase
  delivery were all separately ruled out with authenticated `curl` and
  instrumented logs before this was found). Fix: don't mutate any `@State`
  that the view body reads until *after* all the async work in `load()`
  completes — assign `links`/`groupTitles` together at the end, and only
  flip `isLoading` when there's genuinely nothing on screen yet.
