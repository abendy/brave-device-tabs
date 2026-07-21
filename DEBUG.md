# iOS debugging commands

Reference for debugging the iOS app / share extension from the CLI, without opening Xcode.

## Confirm a build actually reached the device

`ios/run-device.sh` and `ios/run-simulator.sh` both generate a random word into
`ios/Shared/DeploymentMarker.swift` (gitignored) on every run, via
`ios/generate-deployment-marker.sh`. It's shown as `"<word> deployment"` in the
container app's Setup screen (small caption at the bottom of the form) and as
the share sheet's navigation title. The script prints the word it picked, e.g.
`Deployment marker: opal` — if that word doesn't match what's actually on
screen, the install/launch step didn't pick up a fresh build, and that's the
problem to chase before touching any Swift code. This came up for real: a
build that looked successful (`BUILD SUCCEEDED`, `App installed`) still showed
old behavior on-device, because two separate bugs (see Known gotchas below)
meant the *code* running wasn't what had just been compiled.

## List devices

*Run this when:* you need a `<device-id>` for any command below, or a
`devicectl`/`simctl` command is failing because it can't find the device you
meant.

```sh
xcrun devicectl list devices          # paired real devices
xcrun simctl list devices booted      # booted simulators
xcrun simctl list devices available   # every simulator runtime installed, booted or not
```

`devicectl list devices` output includes a `State` column — a real device
needs to show `available (paired)`. If it shows just `available` without
`(paired)`, the Mac and device haven't completed trust pairing (unlock the
device, and accept any "Trust This Computer" prompt).

## Install + launch

*Run this when:* you've already built (see Build below) and need to get the
`.app` onto a device/simulator and running — `run-device.sh`/`run-simulator.sh`
do this automatically, so reach for these directly only when iterating faster
(e.g. reinstalling without a full rebuild) or diagnosing an install/launch
failure in isolation from the build step.

Real device:

```sh
xcrun devicectl device install app --device <device-id> <path-to-.app>
xcrun devicectl device process launch --device <device-id> <bundle-id>
```

`install app` only copies the bundle over — it does not launch it, hence the
second command. If `install` succeeds but `process launch` fails with
`invalid code signature, inadequate entitlements or its profile has not been
explicitly trusted by the user`, the device needs the developer certificate
trusted manually: **Settings → General → VPN & Device Management → \[your
Apple ID/developer profile\] → Trust**. This is a one-time step per
certificate, but can resurface after a full uninstall+reinstall.

Simulator:

```sh
xcrun simctl install <device-id> <path-to-.app>
xcrun simctl launch <device-id> <bundle-id>
```

Simulator installs never need trust confirmation — Simulator builds use local
ad-hoc "Sign to Run Locally" signing regardless of your Team.

**Overwrite-install vs. uninstall-then-install matters.** `simctl install` /
`devicectl device install app` over an existing install preserves app data,
including the shared App Group container both targets read sign-in state
from. A full `simctl uninstall` / `devicectl device uninstall app` wipes that
— useful when you specifically want to rule out stale state, but it also
means you'll need to sign in again afterward. Default to overwrite-install;
only uninstall first when you're actively trying to rule out cached state as
a cause.

## Screenshot a simulator

*Run this when:* you (or I) need to see the actual current UI state on the
simulator — e.g. confirming something rendered correctly, or capturing
evidence of a bug. This is Simulator-only; there's no way to screenshot a real
device from this CLI toolchain (use the physical device's own screenshot
gesture, or Xcode's Devices window, for that).

```sh
xcrun simctl io <device-id> screenshot output.png
```

For a closer look at a small region (e.g. checking for low-contrast/invisible
text), crop and upscale with `sips` (built into macOS, no extra install
needed — `PIL`/Pillow is not available in this environment):

```sh
sips -c <height> <width> --cropOffset <y> <x> input.png --out cropped.png
sips -z <newHeight> <newWidth> cropped.png
```

## Stream simulator logs

Only works for simulators — there's no equivalent for a real device via this
CLI toolchain. (Xcode's own Console app, or `idevicesyslog` from
`libimobiledevice`, are the normal ways to get real-device logs; neither is
available in this environment. This is a real capability gap — when a bug
only reproduces on a real device, the fallback is adding `NSLog`/`print`
debug statements and reasoning from behavior, or temporarily reproducing on
the simulator if the bug isn't simulator-specific.)

```sh
xcrun simctl spawn <device-id> log stream --level debug --predicate 'process == "ShareExtension"'
xcrun simctl spawn <device-id> log stream --level debug --predicate 'eventMessage CONTAINS "DTS-DEBUG"'
```

Run this *before* triggering the action you want to observe (it's a live
tail, not a history query) — launch it in the background, do the action on
device, then read the captured output. Add distinctive `NSLog("[SOME-TAG] ...")`
calls at suspect points in the Swift code and filter on the tag; this is more
reliable than trying to infer behavior from stock system log noise.

## Build

*Run this when:* you've changed Swift code, `project.yml`, or anything else
under `ios/`, and need to compile before installing. This step alone doesn't
put anything on a device — pair it with Install + launch above (or just use
`run-device.sh`/`run-simulator.sh`, which do both).

`ios/run-device.sh` and `ios/run-simulator.sh` wrap this (and also run
`generate-deployment-marker.sh` + `xcodegen generate` first); run it directly
when you want more control, e.g. to grep the output or pass extra flags:

```sh
cd ios
xcodebuild build -project DeviceTabsShare.xcodeproj -scheme DeviceTabsShare \
  -destination "platform=iOS,id=<device-id>" -derivedDataPath build-device

# Simulator equivalent:
xcodebuild build -project DeviceTabsShare.xcodeproj -scheme DeviceTabsShare \
  -destination "platform=iOS Simulator,id=<device-id>" -derivedDataPath build-simulator
```

**Use separate `-derivedDataPath` values per platform.** `run-device.sh` and
`run-simulator.sh` deliberately use `build-device/` and `build-simulator/`
rather than sharing one `build/` directory — they used to share one, and a
stale `Debug-iphonesimulator` product left over from a simulator run got
picked up by the device script's `find | head -1`, which then tried to
install a simulator binary onto a real phone (fails with a code-signature
error that has nothing to do with actual signing problems). If you add a new
build script, give it its own derived-data directory.

Grep the build log for these when something's wrong:

```sh
xcodebuild build ... 2>&1 | grep -iE "error:|Signing Identity|BUILD (SUCCEEDED|FAILED)"
```

`Signing Identity: "Sign to Run Locally"` on a *device* build (not simulator)
means something is wrong with team/provisioning setup — device builds should
show `Signing Identity: "Apple Development: <name> (<id>)"`.

## Inspect a built binary

*Run this when:* signing/entitlements-related errors show up (App Group not
working, "No profiles found", codesign failures) and you need to see what
actually got produced rather than trust what the source files/build settings
say should have happened.

What entitlements actually got signed in — not just what's declared in the
source `.entitlements` file, which can differ. (Simulator's "Sign to Run
Locally" identity silently strips App-ID-bound entitlements like App Groups
even when the source file and build settings are correct; this cost real time
to track down earlier and turned out to be a non-issue functionally on
Simulator, but *is* a real issue for anything that depends on entitlements
being genuinely enforced.)

```sh
codesign -d --entitlements :- <path-to-binary-or-.app>
```

Empty output (`<dict></dict>`) means no entitlements were actually embedded,
regardless of what's in the checked-in `.entitlements` file.

Read a specific key out of an `Info.plist`:

```sh
/usr/libexec/PlistBuddy -c "Print :SomeKey" <path-to-Info.plist>
# nested keys, e.g. the NSExtension dict:
/usr/libexec/PlistBuddy -c "Print :NSExtension" <path-to-Info.plist>
```

Check what's actually installed on a device:

```sh
xcrun devicectl device info apps --device <device-id> --bundle-id <bundle-id>
```

Inspect a provisioning profile directly (team ID, bundle ID, expiry) — useful
because the parenthetical in a certificate's display name (e.g. `"Apple
Development: you@example.com (XXXXXXXXXX)"`) is **not reliably the Team ID**;
the profile's `application-identifier` entitlement (`<TeamID>.<BundleID>`) is
the actual source of truth:

```sh
security cms -D -i /path/to/some.mobileprovision | plutil -extract Entitlements.application-identifier xml1 -o - -
```

Xcode caches provisioning profiles in two different places, and only one of
them is what `xcodebuild`'s CLI signing resolution reads from — this is why
`run-device.sh` copies profiles from Xcode's cache into the legacy location
before building:

- `~/Library/Developer/Xcode/UserData/Provisioning Profiles/` — where Xcode's
  own automatic-signing engine writes newly issued/renewed profiles.
- `~/Library/MobileDevice/Provisioning Profiles/` — where `xcodebuild`
  actually looks. Without profiles here, a real-device build fails with `No
  profiles for '<bundle id>' were found`, even immediately after Xcode's GUI
  successfully signed and ran the same project.

## Known gotchas (found the hard way this session)

- **`strings` on a Swift binary is not a reliable way to check whether new
  code was deployed.** It failed to find plain string literals (like a
  screen's own title, present since the very first build) that were
  definitely in the compiled binary — likely a section-scanning limitation
  specific to how Swift stores string constants. Don't use it as evidence
  either way; use the deployment-marker approach above instead.
- **A signing identity or Team ID can *look* right and still be wrong.** A
  cert's display-name parenthetical isn't guaranteed to be the real Team ID —
  cross-check against an actual provisioning profile's
  `application-identifier` (see above) if builds fail with profile-mismatch
  errors despite `DEVELOPMENT_TEAM` looking correct.
- **Xcode's GUI and `xcodebuild` don't always agree**, even on the identical
  project — GUI-driven signing resolution has done things (successfully
  registering an App ID + capability with Apple, choosing a real signing
  identity) that plain CLI `xcodebuild -allowProvisioningUpdates` did not
  reliably reproduce. When CLI-only signing behaves inexplicably, a one-time
  pass through Xcode's own Signing & Capabilities UI is sometimes the actual
  fix, not another CLI flag.
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
