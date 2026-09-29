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

PocketBase applies any new files in `server/pb_migrations/` automatically on
startup, so picking up schema changes (the discard-button permission, the
`shared_links.destination` field, the `browser_groups` collection used for
routing shares into tab groups) is just `fly deploy` again from `server/` —
no separate migration step.

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

## 3. iOS: build, run, and sign in

The iOS project lives in `ios/`. `ios/DeviceTabsShare.xcodeproj` isn't
committed; generate it from `ios/project.yml` with `xcodegen generate`. Build
and run the **DeviceTabsShare** scheme; it embeds the share extension.

Running on a real device needs signing, with a Team set on both the
**DeviceTabsShare** and **ShareExtension** targets. Both targets use the App
Group `group.com.abendy.devicetabs`, so the first signed build must register
it with Apple. If bundle ID `com.abendy.devicetabs` collides with something
already registered on your team, change the prefix in `ios/project.yml`
(`options.bundleIdPrefix`) and regenerate.

In the running app, enter your PocketBase URL
(`https://device-tabs-sync.fly.dev`) and the regular user's email/password,
then **Sign In**. The share extension reads the same signed-in session
through the App Group, so it needs no separate sign-in.

From Safari (or any app with a share sheet), tap **Share** → **Save to
Device Tabs**. On a Simulator this has to happen by hand in the Simulator
window; nothing on the command line drives the share sheet.

Tap the **Destination** menu to pick from your current tab group names
("No group" plus each group Brave last reported) before posting. It only
knows about groups from the last time the popup was open on desktop — not
a live feed — so if you just created a group, open the popup once before
sharing to it. A destination that doesn't match anything currently open
falls back to a plain ungrouped tab in the current window.

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
