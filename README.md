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
5. Select the unzipped `brave-device-tabs` folder.
6. Pin **Device Tabs Picker** to the toolbar.

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
device alongside your real synced devices.

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

- `manifest.json` — Manifest V3 configuration
- `popup.html` / `popup.css` / `popup.js` — popup markup, styling, and
  sync-session loading, filtering, selection, and opening logic
- `options.html` / `options.css` / `options.js` — Shared Links server setup
- `storage-keys.js` — `chrome.storage.local` key names shared by popup and options
- `icons/` — extension icons
- `server/` — PocketBase backend for Shared Links (Fly.io deploy config)
- `ios/` — iOS container app + Share Extension for Shared Links
- `SETUP.md` — deployment and device setup for Shared Links

## Privacy

The synced-tabs feature is entirely local: it does not transmit, log, or
persist your tab data, and makes no network calls. The optional Shared Links
feature (see above) does make network calls, but only to a PocketBase server
you deploy and control yourself, and only while it's configured in the popup's
settings.
