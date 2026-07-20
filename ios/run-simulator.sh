#!/usr/bin/env bash
# Builds and runs the app on a Simulator entirely from the CLI — no Xcode
# GUI, no Team/signing needed (Simulator builds use local ad-hoc signing).
# Boots the first available iPhone simulator if none is already booted.
set -euo pipefail
cd "$(dirname "$0")"

DEVICE_ID=$(xcrun simctl list devices booted | grep -oE '[0-9A-F-]{36}' | head -1 || true)

if [[ -z "$DEVICE_ID" ]]; then
  echo "No booted simulator — picking the first available iPhone..."
  DEVICE_ID=$(xcrun simctl list devices available | grep -m1 "iPhone" | grep -oE '[0-9A-F-]{36}')
  xcrun simctl boot "$DEVICE_ID"
  open -a Simulator
  sleep 3
fi

echo "Using simulator: $DEVICE_ID"

xcodegen generate

xcodebuild build \
  -project DeviceTabsShare.xcodeproj \
  -scheme DeviceTabsShare \
  -destination "platform=iOS Simulator,id=$DEVICE_ID" \
  -derivedDataPath build

APP_PATH=$(find build/Build/Products -maxdepth 2 -name "DeviceTabsShare.app" | head -1)
BUNDLE_ID=$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$APP_PATH/Info.plist")

xcrun simctl install "$DEVICE_ID" "$APP_PATH"
xcrun simctl launch "$DEVICE_ID" "$BUNDLE_ID"

echo
echo "Installed and launched. To test the share extension, open Safari in the"
echo "simulator, share a page, and pick \"Save to Device Tabs\" — that last part"
echo "still needs to happen by hand in the simulator window, not from the CLI."
