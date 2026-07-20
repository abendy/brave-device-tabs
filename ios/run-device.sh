#!/usr/bin/env bash
# Builds and runs the app on a connected iOS device via the CLI — no Xcode
# GUI needed for day-to-day builds.
#
# One-time prerequisite (not something this script can do): open the project
# in Xcode once, set your Team on both the DeviceTabsShare and ShareExtension
# targets under Signing & Capabilities, and let it finish registering the App
# ID + App Group capability with Apple. See SETUP.md. Put your Team ID in
# ios/Local.xcconfig (copy Local.xcconfig.example) so it survives
# `xcodegen generate`.
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -f Local.xcconfig ]]; then
  echo "ios/Local.xcconfig is missing — copy Local.xcconfig.example and fill in your Team ID first." >&2
  exit 1
fi

# xcodebuild's CLI signing resolution reads provisioning profiles from here...
LEGACY_PROFILES="$HOME/Library/MobileDevice/Provisioning Profiles"
# ...but Xcode's own automatic-signing engine caches newly issued/renewed
# profiles here instead, and doesn't copy them over. Without this sync step,
# a real device build fails with "No profiles for '<bundle id>' were found"
# even right after Xcode's GUI successfully ran the same project.
XCODE_PROFILES="$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"
mkdir -p "$LEGACY_PROFILES"
if [[ -d "$XCODE_PROFILES" ]]; then
  cp -n "$XCODE_PROFILES"/*.mobileprovision "$LEGACY_PROFILES/" 2>/dev/null || true
fi

DEVICE_ID=$(xcrun devicectl list devices 2>/dev/null | awk 'NR>2 && /paired/ {print $3; exit}')
if [[ -z "$DEVICE_ID" ]]; then
  echo "No paired iOS device found. Connect one (USB or Wi-Fi), unlock it, and trust this Mac." >&2
  exit 1
fi
echo "Using device: $DEVICE_ID"

xcodegen generate

xcodebuild build \
  -project DeviceTabsShare.xcodeproj \
  -scheme DeviceTabsShare \
  -destination "platform=iOS,id=$DEVICE_ID" \
  -derivedDataPath build

APP_PATH=$(find build/Build/Products -maxdepth 2 -name "DeviceTabsShare.app" | head -1)
BUNDLE_ID=$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$APP_PATH/Info.plist")

xcrun devicectl device install app --device "$DEVICE_ID" "$APP_PATH"
xcrun devicectl device process launch --device "$DEVICE_ID" "$BUNDLE_ID"

echo
echo "Installed and launched on your device. To test the share extension,"
echo "open Safari, share a page, and pick \"Save to Device Tabs\" — that part"
echo "still has to happen by hand on the device."
