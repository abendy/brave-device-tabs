"use strict";

const OPENED_HISTORY_KEY = "openedHistory";
const MAX_OPENED_BATCHES = 50;

const state = {
  devices: [],
  selected: new Set(),
  filter: "",
  loading: false,
  activeTab: "tabs",
  openedHistory: [],
};

const elements = {
  deviceList: document.querySelector("#device-list"),
  deviceTemplate: document.querySelector("#device-template"),
  tabTemplate: document.querySelector("#tab-template"),
  refreshButton: document.querySelector("#refresh-button"),
  settingsButton: document.querySelector("#settings-button"),
  searchInput: document.querySelector("#search-input"),
  selectVisibleButton: document.querySelector("#select-visible-button"),
  openAllButton: document.querySelector("#open-all-button"),
  openButton: document.querySelector("#open-button"),
  selectionCount: document.querySelector("#selection-count"),
  summary: document.querySelector("#summary"),
  status: document.querySelector("#status"),
  tabsView: document.querySelector("#tabs-view"),
  openedView: document.querySelector("#opened-view"),
  openedList: document.querySelector("#opened-list"),
  footer: document.querySelector("#footer"),
  tabsViewButton: document.querySelector("#tabs-view-button"),
  openedViewButton: document.querySelector("#opened-view-button"),
};

document.addEventListener("DOMContentLoaded", initialize);

function initialize() {
  elements.refreshButton.addEventListener("click", refreshAll);
  elements.settingsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());
  elements.searchInput.addEventListener("input", handleFilterInput);
  elements.selectVisibleButton.addEventListener("click", toggleVisibleSelection);
  elements.openAllButton.addEventListener("click", openAllTabs);
  elements.openButton.addEventListener("click", openSelectedTabs);
  elements.tabsViewButton.addEventListener("click", () => setActiveView("tabs"));
  elements.openedViewButton.addEventListener("click", () => setActiveView("opened"));
  refreshAll();
}

async function refreshAll() {
  if (state.loading) return;

  setLoading(true);
  hideStatus();

  // Each loader swallows its own errors and resolves to a safe fallback, so
  // one failing (e.g. no Shared Links server configured) never blocks the
  // other from rendering.
  const [syncedDevices, sharedDevice, openedHistory] = await Promise.all([
    loadSyncedDevices(),
    loadSharedLinksDevice(),
    loadOpenedHistory(),
  ]);

  state.openedHistory = openedHistory;
  const openedIds = getOpenedIdSet(openedHistory);
  const filteredSynced = filterOpenedTabs(syncedDevices, openedIds);
  const filteredShared = sharedDevice ? filterOpenedTabs([sharedDevice], openedIds) : [];

  state.devices = [...filteredShared, ...filteredSynced];
  removeStaleSelections();
  setLoading(false);
  render();

  if (state.activeTab === "opened") renderOpenedView();
}

function filterOpenedTabs(devices, openedIds) {
  return devices
    .map((device) => ({ ...device, tabs: device.tabs.filter((tab) => !openedIds.has(tab.id)) }))
    .filter((device) => device.tabs.length > 0);
}

async function loadSyncedDevices() {
  try {
    if (!chrome.sessions?.getDevices) {
      throw new Error("This browser does not expose the synced-sessions API.");
    }

    const rawDevices = await getSyncedDevices();
    return normalizeDevices(rawDevices);
  } catch (error) {
    console.error("Unable to load synced device tabs:", error);
    showStatus(
      "Could not read synced tabs. Confirm Brave Sync is enabled and “Open Tabs” is selected on both devices.",
      true
    );
    return [];
  }
}

async function loadSharedLinksDevice() {
  try {
    const { [STORAGE_KEYS.serverUrl]: serverUrl, [STORAGE_KEYS.token]: token } = await chrome.storage.local.get([
      STORAGE_KEYS.serverUrl,
      STORAGE_KEYS.token,
    ]);

    if (!serverUrl || !token) return null;

    const query = `filter=${encodeURIComponent("(opened=false)")}&sort=-created`;
    const response = await fetch(`${serverUrl}/api/collections/shared_links/records?${query}`, {
      headers: { Authorization: token },
    });

    if (!response.ok) {
      throw new Error(`Shared Links request failed (${response.status}).`);
    }

    const data = await response.json();
    const tabs = (data.items ?? [])
      .map(normalizeSharedLink)
      .filter((tab) => tab.url && isOpenableUrl(tab.url));

    if (tabs.length === 0) return null;

    return { id: "shared-links", name: "Shared Links", tabs };
  } catch (error) {
    // Silent by design: an unconfigured or unreachable server must not
    // block the synced-tabs list, which is the extension's core feature.
    console.warn("Unable to load shared links:", error);
    return null;
  }
}

function normalizeSharedLink(record) {
  const title = record.title?.trim() || readableUrl(record.url) || "Untitled link";
  const source = record.source || "Shared Links";

  return {
    id: `shared:${record.id}`,
    title,
    url: record.url,
    source,
    searchable: `shared links ${source} ${title} ${record.url}`.toLocaleLowerCase(),
  };
}

// Brave versions differ in whether sessions.getDevices() returns a Promise.
// Supplying a callback works in both callback-only and Promise-capable builds.
function getSyncedDevices() {
  return new Promise((resolve, reject) => {
    chrome.sessions.getDevices({}, (devices) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve(devices ?? []);
    });
  });
}

function normalizeDevices(rawDevices) {
  return (rawDevices ?? [])
    .map((device, deviceIndex) => {
      const tabs = (device.sessions ?? [])
        .flatMap((session) => {
          if (session.window?.tabs) return session.window.tabs;
          if (session.tab) return [session.tab];
          return [];
        })
        .reverse()
        .map((tab, tabIndex) => normalizeTab(tab, device.deviceName, tabIndex))
        .filter((tab) => tab.url && isOpenableUrl(tab.url));

      return {
        id: `device-${deviceIndex}-${slug(device.deviceName || "unknown")}`,
        name: device.deviceName || `Device ${deviceIndex + 1}`,
        tabs: deduplicateTabs(tabs),
      };
    })
    .filter((device) => device.tabs.length > 0);
}

function normalizeTab(tab, deviceName, tabIndex) {
  const url = tab.url || "";
  const title = tab.title?.trim() || readableUrl(url) || "Untitled tab";
  const stablePart = tab.sessionId || `${url}-${tabIndex}`;

  return {
    // No deviceIndex in the id - it's just an array position and can shift
    // between refreshes if Brave reorders foreign devices, which would break
    // the opened-history "have I seen this id before" lookup across reloads.
    id: `sync:${hashString(`${deviceName}|${stablePart}`)}`,
    title,
    url,
    source: deviceName,
    searchable: `${deviceName} ${title} ${url}`.toLocaleLowerCase(),
  };
}

function deduplicateTabs(tabs) {
  const seen = new Set();

  return tabs.filter((tab) => {
    if (seen.has(tab.url)) return false;
    seen.add(tab.url);
    return true;
  });
}

function isOpenableUrl(url) {
  try {
    const parsed = new URL(url);
    return ["http:", "https:", "file:", "ftp:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function readableUrl(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.hostname}${path}`;
  } catch {
    return url;
  }
}

function render() {
  elements.deviceList.replaceChildren();

  const totalTabs = state.devices.reduce((sum, device) => sum + device.tabs.length, 0);
  elements.summary.textContent = state.loading
    ? "Loading synced tabs…"
    : `${state.devices.length} ${pluralize(state.devices.length, "device")} · ${totalTabs} ${pluralize(totalTabs, "tab")}`;

  if (!state.loading && state.devices.length === 0) {
    renderEmptyState();
    updateControls();
    return;
  }

  for (const device of state.devices) {
    renderDevice(device);
  }

  applyFilter();
  updateControls();
}

function renderDevice(device) {
  const fragment = elements.deviceTemplate.content.cloneNode(true);
  const section = fragment.querySelector(".device");
  const deviceCheckbox = fragment.querySelector(".device-checkbox");
  const deviceName = fragment.querySelector(".device-name");
  const deviceCount = fragment.querySelector(".device-count");
  const tabsContainer = fragment.querySelector(".tabs");

  section.dataset.deviceId = device.id;
  deviceName.textContent = device.name;
  deviceName.title = device.name;
  deviceCount.textContent = `${device.tabs.length} ${pluralize(device.tabs.length, "tab")}`;
  deviceCheckbox.dataset.deviceId = device.id;
  deviceCheckbox.addEventListener("change", () => toggleDevice(device.id, deviceCheckbox.checked));

  for (const tab of device.tabs) {
    const tabFragment = elements.tabTemplate.content.cloneNode(true);
    const row = tabFragment.querySelector(".tab-row");
    const checkbox = tabFragment.querySelector(".tab-checkbox");
    const title = tabFragment.querySelector(".tab-title");
    const url = tabFragment.querySelector(".tab-url");
    const deleteButton = tabFragment.querySelector(".tab-delete-button");

    row.dataset.tabId = tab.id;
    row.dataset.searchable = tab.searchable;
    checkbox.dataset.tabId = tab.id;
    checkbox.checked = state.selected.has(tab.id);
    checkbox.addEventListener("change", () => toggleTab(tab.id, checkbox.checked));
    title.textContent = tab.title;
    title.title = tab.title;
    url.textContent = tab.url;
    url.title = tab.url;

    if (device.id === "shared-links") {
      deleteButton.hidden = false;
      deleteButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        deleteSharedLink(tab.id);
      });
    }

    tabsContainer.append(tabFragment);
  }

  elements.deviceList.append(fragment);
  updateDeviceCheckbox(device.id);
}

function renderEmptyState() {
  const empty = document.createElement("div");
  empty.className = "empty";

  const title = document.createElement("p");
  title.className = "empty-title";
  title.textContent = "No synced device tabs found";

  const copy = document.createElement("p");
  copy.className = "empty-copy";
  copy.textContent =
    "In Brave Sync, enable Open Tabs on your iPhone and Mac, open a few pages on the iPhone, then refresh.";

  empty.append(title, copy);
  elements.deviceList.append(empty);
}

function setActiveView(view) {
  state.activeTab = view;
  elements.tabsView.hidden = view !== "tabs";
  elements.openedView.hidden = view !== "opened";
  elements.footer.hidden = view !== "tabs";
  elements.tabsViewButton.classList.toggle("is-active", view === "tabs");
  elements.tabsViewButton.setAttribute("aria-selected", String(view === "tabs"));
  elements.openedViewButton.classList.toggle("is-active", view === "opened");
  elements.openedViewButton.setAttribute("aria-selected", String(view === "opened"));

  if (view === "opened") renderOpenedView();
}

function renderOpenedView() {
  elements.openedList.replaceChildren();

  if (state.openedHistory.length === 0) {
    renderOpenedEmptyState();
    return;
  }

  for (const batch of state.openedHistory) {
    elements.openedList.append(buildOpenedBatch(batch));
  }
}

function buildOpenedBatch(batch) {
  const section = document.createElement("section");
  section.className = "opened-batch";

  const header = document.createElement("div");
  header.className = "opened-batch-header";
  header.textContent = formatBatchTime(batch.openedAt);

  const items = document.createElement("div");
  items.className = "opened-batch-items";

  for (const item of batch.items) {
    const row = document.createElement("div");
    row.className = "opened-row";

    const title = document.createElement("span");
    title.className = "opened-title";
    title.textContent = item.title;
    title.title = item.title;

    const meta = document.createElement("span");
    meta.className = "opened-meta";
    meta.textContent = `${item.source} · ${item.url}`;
    meta.title = item.url;

    row.append(title, meta);
    items.append(row);
  }

  section.append(header, items);
  return section;
}

function formatBatchTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown time";

  const timePart = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (date.toDateString() === new Date().toDateString()) return `Today at ${timePart}`;

  const datePart = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${datePart} at ${timePart}`;
}

function renderOpenedEmptyState() {
  const empty = document.createElement("div");
  empty.className = "empty";

  const title = document.createElement("p");
  title.className = "empty-title";
  title.textContent = "Nothing opened yet";

  const copy = document.createElement("p");
  copy.className = "empty-copy";
  copy.textContent = "Tabs you open from here show up as history, grouped by when you opened them.";

  empty.append(title, copy);
  elements.openedList.append(empty);
}

function handleFilterInput(event) {
  state.filter = event.target.value.trim().toLocaleLowerCase();
  applyFilter();
  updateControls();
}

function applyFilter() {
  for (const section of elements.deviceList.querySelectorAll(".device")) {
    const rows = [...section.querySelectorAll(".tab-row")];
    let visibleCount = 0;

    for (const row of rows) {
      const visible = !state.filter || row.dataset.searchable.includes(state.filter);
      row.hidden = !visible;
      if (visible) visibleCount += 1;
    }

    section.hidden = visibleCount === 0;
    const count = section.querySelector(".device-count");
    if (count) {
      const device = findDevice(section.dataset.deviceId);
      count.textContent = state.filter
        ? `${visibleCount} of ${device?.tabs.length ?? 0}`
        : `${device?.tabs.length ?? 0} ${pluralize(device?.tabs.length ?? 0, "tab")}`;
    }
  }
}

function toggleTab(tabId, checked) {
  checked ? state.selected.add(tabId) : state.selected.delete(tabId);
  updateAllDeviceCheckboxes();
  updateControls();
}

function toggleDevice(deviceId, checked) {
  const device = findDevice(deviceId);
  if (!device) return;

  const visibleIds = getVisibleTabIds(deviceId);
  const ids = state.filter ? visibleIds : device.tabs.map((tab) => tab.id);

  for (const id of ids) {
    checked ? state.selected.add(id) : state.selected.delete(id);
  }

  syncRenderedTabCheckboxes();
  updateDeviceCheckbox(deviceId);
  updateControls();
}

function toggleVisibleSelection() {
  const visibleIds = getAllVisibleTabIds();
  if (visibleIds.length === 0) return;

  const allVisibleSelected = visibleIds.every((id) => state.selected.has(id));

  for (const id of visibleIds) {
    allVisibleSelected ? state.selected.delete(id) : state.selected.add(id);
  }

  syncRenderedTabCheckboxes();
  updateAllDeviceCheckboxes();
  updateControls();
}

function getVisibleTabIds(deviceId) {
  const section = elements.deviceList.querySelector(`[data-device-id="${cssEscape(deviceId)}"]`);
  if (!section) return [];

  return [...section.querySelectorAll(".tab-row:not([hidden])")].map((row) => row.dataset.tabId);
}

function getAllVisibleTabIds() {
  return [...elements.deviceList.querySelectorAll(".device:not([hidden]) .tab-row:not([hidden])")]
    .map((row) => row.dataset.tabId);
}

function updateAllDeviceCheckboxes() {
  for (const device of state.devices) {
    updateDeviceCheckbox(device.id);
  }
}

function updateDeviceCheckbox(deviceId) {
  const device = findDevice(deviceId);
  const section = elements.deviceList.querySelector(`[data-device-id="${cssEscape(deviceId)}"]`);
  const checkbox = section?.querySelector(".device-checkbox");

  if (!device || !checkbox) return;

  const relevantIds = state.filter
    ? getVisibleTabIds(deviceId)
    : device.tabs.map((tab) => tab.id);
  const selectedCount = relevantIds.filter((id) => state.selected.has(id)).length;

  checkbox.checked = relevantIds.length > 0 && selectedCount === relevantIds.length;
  checkbox.indeterminate = selectedCount > 0 && selectedCount < relevantIds.length;
}

function syncRenderedTabCheckboxes() {
  for (const checkbox of elements.deviceList.querySelectorAll(".tab-checkbox")) {
    checkbox.checked = state.selected.has(checkbox.dataset.tabId);
  }
}

function updateControls() {
  const count = state.selected.size;
  const totalTabs = getAllTabs().length;
  elements.selectionCount.textContent = `${count} selected`;
  elements.openAllButton.disabled = totalTabs === 0 || state.loading;
  elements.openAllButton.textContent = totalTabs > 0 ? `Open all (${totalTabs})` : "Open all";
  elements.openButton.disabled = count === 0 || state.loading;
  elements.openButton.textContent = count > 0 ? `Open selected (${count})` : "Open selected";

  const visibleIds = getAllVisibleTabIds();
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => state.selected.has(id));
  elements.selectVisibleButton.textContent = allVisibleSelected ? "Clear visible" : "Select visible";
  elements.selectVisibleButton.disabled = visibleIds.length === 0;
}

async function openSelectedTabs() {
  const selectedTabs = getAllTabs()
    .filter((tab) => state.selected.has(tab.id));

  await openTabs(selectedTabs, elements.openButton);
}

async function openAllTabs() {
  await openTabs(getAllTabs(), elements.openAllButton);
}

function getAllTabs() {
  return state.devices.flatMap((device) => device.tabs);
}

async function openTabs(tabs, triggerButton) {
  if (tabs.length === 0) return;

  elements.openAllButton.disabled = true;
  elements.openButton.disabled = true;
  triggerButton.textContent = "Opening…";
  hideStatus();

  try {
    const windowId = await getCurrentWindowId();

    // Open every tab backgrounded first. Activating a tab mid-loop would
    // shift focus away from this popup, and Chrome/Brave close extension
    // popups the instant they lose focus - killing the loop early and
    // leaving later tabs unopened. Activate the first tab only once
    // everything has been created.
    let firstTabId;
    for (let index = 0; index < tabs.length; index += 1) {
      const created = await chrome.tabs.create({
        windowId,
        url: tabs[index].url,
        active: false,
      });
      if (index === 0) firstTabId = created.id;
    }

    // Bookkeeping happens before activating the new tab, not after. Activating
    // it (below) shifts focus away from this popup, and Chrome/Brave may tear
    // the popup down as soon as that happens - racing against whatever's
    // still in flight. Doing this first guarantees it completes while the
    // popup is still definitely alive.
    await markSharedLinksOpened(tabs);
    await recordOpenedBatch(tabs);

    if (firstTabId !== undefined) {
      await chrome.tabs.update(firstTabId, { active: true });
    }

    window.close();
  } catch (error) {
    console.error("Unable to open selected tabs:", error);
    showStatus("Some tabs could not be opened. Try a smaller selection.", true);
    updateControls();
  }
}

async function deleteSharedLink(tabId) {
  const recordId = tabId.slice("shared:".length);

  const { [STORAGE_KEYS.serverUrl]: serverUrl, [STORAGE_KEYS.token]: token } = await chrome.storage.local.get([
    STORAGE_KEYS.serverUrl,
    STORAGE_KEYS.token,
  ]);
  if (!serverUrl || !token) return;

  try {
    const response = await fetch(`${serverUrl}/api/collections/shared_links/records/${recordId}`, {
      method: "DELETE",
      headers: { Authorization: token },
    });

    // A 404 means it's already gone (e.g. deleted from another tab) - treat
    // that as success rather than surfacing an error for a state the user
    // already has.
    if (!response.ok && response.status !== 404) {
      throw new Error(`Delete failed (${response.status}).`);
    }
  } catch (error) {
    console.error("Unable to delete shared link:", error);
    showStatus("Could not discard that link. Try again.", true);
    return;
  }

  // Outside the try/catch: the delete already succeeded server-side by this
  // point, so a rendering error here must never be reported as a failed
  // deletion.
  removeTabFromState(tabId);
  render();
}

function removeTabFromState(tabId) {
  state.selected.delete(tabId);

  for (const device of state.devices) {
    const index = device.tabs.findIndex((tab) => tab.id === tabId);
    if (index !== -1) {
      device.tabs.splice(index, 1);
      break;
    }
  }

  state.devices = state.devices.filter((device) => device.tabs.length > 0);
}

async function loadOpenedHistory() {
  const { [OPENED_HISTORY_KEY]: history } = await chrome.storage.local.get(OPENED_HISTORY_KEY);
  return history ?? [];
}

async function recordOpenedBatch(tabs) {
  const history = await loadOpenedHistory();
  const batch = {
    id: `${Date.now()}`,
    openedAt: new Date().toISOString(),
    items: tabs.map((tab) => ({ id: tab.id, title: tab.title, url: tab.url, source: tab.source })),
  };

  const updated = [batch, ...history].slice(0, MAX_OPENED_BATCHES);
  await chrome.storage.local.set({ [OPENED_HISTORY_KEY]: updated });
  return updated;
}

function getOpenedIdSet(history) {
  const ids = new Set();

  for (const batch of history) {
    for (const item of batch.items) ids.add(item.id);
  }

  return ids;
}

async function markSharedLinksOpened(tabs) {
  const sharedIds = tabs
    .filter((tab) => tab.id.startsWith("shared:"))
    .map((tab) => tab.id.slice("shared:".length));

  if (sharedIds.length === 0) return;

  const { [STORAGE_KEYS.serverUrl]: serverUrl, [STORAGE_KEYS.token]: token } = await chrome.storage.local.get([
    STORAGE_KEYS.serverUrl,
    STORAGE_KEYS.token,
  ]);
  if (!serverUrl || !token) return;

  await Promise.all(
    sharedIds.map((id) =>
      fetch(`${serverUrl}/api/collections/shared_links/records/${id}`, {
        method: "PATCH",
        headers: { Authorization: token, "Content-Type": "application/json" },
        body: JSON.stringify({ opened: true }),
      }).catch((error) => console.warn(`Could not mark shared link ${id} opened:`, error))
    )
  );
}

function getCurrentWindowId() {
  return new Promise((resolve, reject) => {
    chrome.windows.getCurrent({}, (currentWindow) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      if (currentWindow?.id === undefined) {
        reject(new Error("Unable to identify the current browser window."));
        return;
      }

      resolve(currentWindow.id);
    });
  });
}

function removeStaleSelections() {
  const validIds = new Set(
    state.devices.flatMap((device) => device.tabs.map((tab) => tab.id))
  );

  for (const id of state.selected) {
    if (!validIds.has(id)) state.selected.delete(id);
  }
}

function findDevice(deviceId) {
  return state.devices.find((device) => device.id === deviceId);
}

function setLoading(loading) {
  state.loading = loading;
  elements.refreshButton.disabled = loading;
  elements.refreshButton.classList.toggle("is-spinning", loading);
  elements.searchInput.disabled = loading;
  updateControls();
}

function showStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("error", isError);
  elements.status.hidden = false;
}

function hideStatus() {
  elements.status.hidden = true;
  elements.status.textContent = "";
  elements.status.classList.remove("error");
}

function pluralize(count, singular) {
  return count === 1 ? singular : `${singular}s`;
}

function slug(value) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function hashString(value) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) return CSS.escape(value);
  return value.replace(/["\\]/g, "\\$&");
}
