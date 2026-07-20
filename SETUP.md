# Setup: Shared Links (iOS Share Extension → PocketBase → Device Tabs Picker)

This covers every step that needs a human at the keyboard — account logins,
billing, code signing. Everything else (server code, extension code, the iOS
project) is already built and verified; this doc is just how to stand it up.

You need: a [Fly.io](https://fly.io) account, `flyctl` installed
(`brew install flyctl`), and Xcode with an Apple ID signed in (a free personal
team is enough to run on your own devices/simulator).

## 1. Deploy PocketBase to Fly.io

```sh
cd server
fly auth login
```

`fly.toml` already names the app `device-tabs-sync` — if that's taken, edit
the `app =` line before continuing.

```sh
fly launch --no-deploy   # detects fly.toml + Dockerfile, creates the app
fly volumes create pb_data --size 1 --region iad   # match fly.toml's primary_region
fly deploy
```

`min_machines_running = 1` in `fly.toml` keeps one instance always on, so both
the iOS share sheet and the browser popup get fast responses — no cold start.

## 2. Create your PocketBase accounts

Two accounts: a **superuser** (admin access, used only for setup) and one
**regular user** (used by the iOS app and the browser extension day to day —
keeps the admin credential out of client storage).

Run the setup script — it prompts for each value (passwords are hidden input,
never typed as command-line flags) and verifies the app user can actually
sign in before finishing:

```sh
./server/create-accounts.sh
```

It asks for: your Fly app name, a superuser email/password (created via
`fly ssh console`), and the regular app user's email/password. Use that
**regular user's** email/password (not the superuser's) everywhere below —
the iOS app, the extension options page.

<details>
<summary>Manual alternative, if you'd rather not run the script</summary>

```sh
fly ssh console -C "/pb/pocketbase superuser upsert you@example.com <admin-password>"

APP_URL="https://device-tabs-sync.fly.dev"

ADMIN_TOKEN=$(curl -s -X POST "$APP_URL/api/collections/_superusers/auth-with-password" \
  -H "Content-Type: application/json" \
  -d '{"identity":"you@example.com","password":"<admin-password>"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")

curl -s -X POST "$APP_URL/api/collections/users/records" \
  -H "Authorization: $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"<app-password>","passwordConfirm":"<app-password>"}'
```

</details>

No CORS setup needed — PocketBase sends `Access-Control-Allow-Origin: *` by
default, so both the browser extension and Safari can reach it out of the box.

## 3. iOS: sign, build, and run

### Simulator, entirely from the CLI

Simulator builds use local ad-hoc signing, so this needs no Apple Developer
Team and never opens Xcode:

```sh
./ios/run-simulator.sh
```

It boots a simulator if none is running, builds, installs, and launches the
app. In the running app, enter your PocketBase URL
(`https://device-tabs-sync.fly.dev`) and the regular user's email/password,
then **Sign In**. To test the share extension itself, open Safari inside the
simulator, share a page, and pick **Save to Device Tabs** — that last part
has to happen by hand in the simulator window; there's no CLI equivalent for
driving the share sheet.

### Real device, via Xcode

A physical device needs real code signing, which means a Team and Xcode's
Signing & Capabilities UI:

```sh
cd ios
xcodegen generate   # already run once during development; re-run after editing project.yml
open DeviceTabsShare.xcodeproj
```

1. Select the **DeviceTabsShare** target → *Signing & Capabilities* → set your
   **Team**. Repeat for the **ShareExtension** target.
2. If bundle ID `com.abendy.devicetabs` collides with something already
   registered on your team, change the prefix in `ios/project.yml`
   (`options.bundleIdPrefix`) and re-run `xcodegen generate`.
3. Build and run the **DeviceTabsShare** scheme on your device. Sign in the
   same way as above.
4. From Safari (or any app with a share sheet), tap **Share** → **Save to
   Device Tabs**. The share extension reads the same signed-in session via
   the shared App Group, so no separate sign-in is needed there.

## 4. Browser extension: point it at your server

1. Load the extension unpacked (see `README.md`) if you haven't already.
2. Click the gear icon in the popup to open **Shared Links** settings.
3. Enter the same server URL and regular-user credentials, click **Sign In**.
   Chrome/Brave will ask you to confirm access to that server's origin —
   approve it.
4. Share a link from your iPhone, then click the refresh icon in the popup —
   it should appear under a **Shared Links** group. Opening it clears it from
   the list.

## Troubleshooting

- **Nothing shows up in the popup after sharing**: confirm the iOS app shows
  "Signed in" (Setup screen), and that the extension's options page shows
  "Connected to ...". Both need to point at the *same* PocketBase URL.
- **Share extension shows "Open the app and sign in first"**: the App Group
  (`group.com.abendy.devicetabs`) isn't sharing state between the two
  targets — usually means the container app hasn't been run at least once
  after a fresh install, or the Team/App Group capability wasn't accepted in
  the Apple Developer portal.
- **`fly deploy` fails to build**: flyctl builds remotely by default, so a
  local Docker daemon isn't required — but if you'd rather build locally,
  start Docker Desktop and add `--local-only` to the deploy command.
