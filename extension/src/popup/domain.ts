import type { Device, DeviceTab, OpenedBatch, VisibleDevice } from "./types";

const OPENABLE_PROTOCOLS = new Set(["file:", "ftp:", "http:", "https:"]);

export interface SharedLinkRecord {
  destination?: string;
  id: string;
  source?: string;
  title?: string;
  url: string;
}

export interface TabDestination {
  groupId: number | null;
  windowId: number;
}

export function normalizeDevices(rawDevices: chrome.sessions.Device[]): Device[] {
  return rawDevices
    .map((device, deviceIndex) => normalizeDevice(device, deviceIndex))
    .filter((device) => device.tabs.length > 0);
}

function normalizeDevice(device: chrome.sessions.Device, deviceIndex: number): Device {
  const deviceName = device.deviceName || `Device ${deviceIndex + 1}`;
  const tabs = device.sessions
    .flatMap((session) => {
      if (session.window?.tabs) {
        return session.window.tabs;
      }
      return session.tab ? [session.tab] : [];
    })
    .reverse()
    .map((tab, tabIndex) => normalizeTab(tab, deviceName, tabIndex))
    .filter((tab) => tab.url && isOpenableUrl(tab.url));

  return {
    id: `device-${deviceIndex}-${slug(deviceName)}`,
    name: deviceName,
    tabs: deduplicateTabs(tabs),
  };
}

function normalizeTab(tab: chrome.tabs.Tab, deviceName: string, tabIndex: number): DeviceTab {
  const url = tab.url || "";
  const title = tab.title?.trim() || readableUrl(url) || "Untitled tab";
  const stablePart = tab.sessionId || `${url}-${tabIndex}`;

  return {
    destination: null,
    id: `sync:${hashString(`${deviceName}|${stablePart}`)}`,
    searchable: `${deviceName} ${title} ${url}`.toLocaleLowerCase(),
    source: deviceName,
    title,
    url,
  };
}

export function normalizeSharedLink(record: SharedLinkRecord): DeviceTab {
  const title = record.title?.trim() || readableUrl(record.url) || "Untitled link";
  const source = record.source || "Shared Links";

  return {
    destination: record.destination?.trim() || null,
    id: `shared:${record.id}`,
    searchable: `shared links ${source} ${title} ${record.url}`.toLocaleLowerCase(),
    source,
    title,
    url: record.url,
  };
}

export function groupSharedLinksByDestination(tabs: DeviceTab[]): Device[] {
  const groups = new Map<string, DeviceTab[]>();

  for (const tab of tabs) {
    const key = tab.destination || "";
    const group = groups.get(key) ?? [];
    group.push(tab);
    groups.set(key, group);
  }

  return [...groups.keys()].sort(compareDestinations).map((destination) => ({
    id: `shared-links:${destination ? slug(destination) : "none"}`,
    name: destination || "Shared Links",
    tabs: groups.get(destination) ?? [],
  }));
}

function compareDestinations(left: string, right: string): number {
  if (left === "" || right === "") {
    if (left === right) {
      return 0;
    }
    return left === "" ? -1 : 1;
  }
  return left.localeCompare(right);
}

export function filterOpenedTabs(devices: Device[], openedIds: ReadonlySet<string>): Device[] {
  return devices
    .map((device) => ({ ...device, tabs: device.tabs.filter((tab) => !openedIds.has(tab.id)) }))
    .filter((device) => device.tabs.length > 0);
}

export function getOpenedIdSet(history: OpenedBatch[]): Set<string> {
  const ids = new Set<string>();
  for (const batch of history) {
    for (const item of batch.items) {
      ids.add(item.id);
    }
  }
  return ids;
}

export function getVisibleDevices(devices: Device[], filter: string): VisibleDevice[] {
  return devices
    .map((device) => ({
      device,
      tabs: filter ? device.tabs.filter((tab) => tab.searchable.includes(filter)) : device.tabs,
    }))
    .filter((entry) => entry.tabs.length > 0);
}

export function resolveTabDestination(
  tab: DeviceTab,
  defaultWindowId: number,
  liveGroups: chrome.tabGroups.TabGroup[],
): TabDestination {
  if (!tab.destination) {
    return { groupId: null, windowId: defaultWindowId };
  }

  const target = tab.destination.trim().toLocaleLowerCase();
  const match = liveGroups.find((group) => group.title?.trim().toLocaleLowerCase() === target);
  return match
    ? { groupId: match.id, windowId: match.windowId }
    : { groupId: null, windowId: defaultWindowId };
}

export function isOpenableUrl(url: string): boolean {
  try {
    return OPENABLE_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

export function readableUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.hostname}${path}`;
  } catch {
    return url;
  }
}

export function formatBatchTime(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }

  const timePart = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (date.toDateString() === now.toDateString()) {
    return `Today at ${timePart}`;
  }

  const datePart = date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return `${datePart} at ${timePart}`;
}

export function pluralize(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

function deduplicateTabs(tabs: DeviceTab[]): DeviceTab[] {
  const seen = new Set<string>();
  return tabs.filter((tab) => {
    if (seen.has(tab.url)) {
      return false;
    }
    seen.add(tab.url);
    return true;
  });
}

function slug(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function hashString(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}
