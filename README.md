# Device Tabs Picker for Brave

A local Manifest V3 extension that lists synced tabs from each foreign Brave device, lets you select individual tabs, and opens the selection in the currently focused desktop window.

It optionally also shows links shared from an iPhone via a companion Share
Extension — see [Shared Links](#shared-links-optional) below.

## Features

- Lists tabs grouped by synced device
- Checkbox for every tab
- Select or clear a whole device
- Search by device, page title, or URL
- Select or clear all currently visible results
- Refresh synced sessions
- Opens selected URLs in the current Brave window
- Opens all synced tabs at once without requiring a selection
- Deduplicates identical URLs within each device
- Requests `sessions` to list synced devices and `tabs` to read tab titles and URLs
- No analytics, background process, or remote code. The synced-tabs feature
  makes no network calls; the optional Shared Links feature below does — see
  that section for exactly what and why.

## Install in Brave

1. Unzip `brave-device-tabs.zip`.
2. Open `brave://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the unzipped folder containing `manifest.json`.
6. Pin **Device Tabs Picker** to the toolbar.

## Develop the extension

The popup and options page are React and TypeScript applications built with
Vite, living in `extension/`. Development requires Node.js 22 or newer and
pnpm 10.33.

```sh
cd extension
pnpm install
pnpm verify
```

`pnpm build` creates the unpacked extension in `extension/dist/`. In
`brave://extensions`, load that `extension/dist/` directory rather than the
repository root. Run `pnpm dev:extension` to rebuild `dist/` while editing,
then reload the extension from Brave's extensions page.

For ordinary browser-based UI work, `pnpm dev` serves a popup preview with
sample devices at `http://127.0.0.1:5173/popup.html`. This preview does not
exercise Brave's extension APIs; the Vitest suite covers those boundaries with
controlled mocks.

## Required Brave Sync setting

On both the iPhone and Mac, ensure they belong to the same Brave Sync chain and that **Open Tabs** is enabled.

After changing Sync settings, open or reload a page on the iPhone and allow a moment for the session to synchronize. Click the extension's refresh button afterward.

## Use

1. Click the extension icon.
2. Select tabs from one or more devices.
3. Click **Open selected**.

The first selected URL becomes active. Remaining URLs open as background tabs in the currently focused Brave window.

## Shared Links (optional)

Brave Sync has no public API for third-party apps to write into it, so links
shared from an iPhone can't join the sync chain this extension reads. Instead,
an iOS Share Extension (`ios/`) posts shared URLs to a small self-hosted
[PocketBase](https://pocketbase.io) instance (`server/`), and this extension
polls that same instance and merges unopened links in as a "Shared Links"
device alongside your real synced devices. At share time on iOS you can also
pick a destination tab group (synced from the popup's own current
`chrome.tabGroups` state) so the link opens straight into the right window and
group instead of as a plain tab — with "no group" always available as a
fallback.

This is off by default — nothing changes until you configure a server via the
popup's gear icon. Full setup (deploying the server, signing the iOS app,
connecting the extension) is in [`SETUP.md`](SETUP.md).

## Troubleshooting

### No devices or tabs appear

- Confirm both devices are on the same Brave Sync chain.
- Confirm **Open Tabs** is enabled on both devices.
- Open or reload a normal `https://` page on the iPhone.
- In desktop Brave, check whether the mobile tabs appear in the browser's synced-tabs/history interface.
- Restart Brave Sync or desktop Brave if its foreign-session data is stale.

The extension reads the foreign sessions that Brave exposes through Chromium's `chrome.sessions.getDevices()` API. It cannot directly contact the iPhone or force Brave Sync to upload a session.

### Some pages are absent

Browser-internal pages such as new-tab, settings, and other non-transferable URLs may not be synchronized or exposed. The extension opens normal HTTP, HTTPS, file, and FTP URLs.

## Files

- `extension/manifest.json` — Manifest V3 configuration
- `extension/popup.html` / `popup.css` — Vite popup entry and Aqua styling
- `extension/src/popup/` — React components, state controller, domain logic, and browser services
- `extension/options.html` / `options.css` / `src/options/` — React-based Shared Links server setup
- `extension/src/shared/` — storage keys shared by the popup and options page
- `extension/tests/` — Vitest domain, UI, and browser-boundary tests
- `extension/package.json`, `vite.config.ts`, `biome.json`, and `oxlintrc.json` — development toolchain
- `extension/icons/` — extension icons
- `extension/dist/` — generated unpacked extension (ignored by Git)
- `server/` — PocketBase backend for Shared Links (Fly.io deploy config)
- `ios/` — iOS container app + Share Extension for Shared Links
- `SETUP.md` — deployment and device setup for Shared Links

## Privacy

The synced-tabs feature is entirely local: it does not transmit, log, or
persist your tab data, and makes no network calls. The optional Shared Links
feature (see above) does make network calls, but only to a PocketBase server
you deploy and control yourself, and only while it's configured in the popup's
settings.
