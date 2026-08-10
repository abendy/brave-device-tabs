import type { Device, DeviceTab, OpenedBatch, VisibleDevice } from "./types";

const OPENABLE_PROTOCOLS = new Set(["file:", "ftp:", "http:", "https:"]);

export interface SharedLinkRecord {
  destination?: string;
  destinationWindowId?: number;
  id: string;
  source?: string;
  title?: string;
  url: string;
}

export interface TabDestination {
  groupId: number | null;
  /** Set when `destination` didn't match any live group, so the caller needs to create one. */
  newGroupTitle: string | null;
  windowId: number;
}

interface SharedLinkGroup {
  destination: string;
  destinationKey: string;
  tabs: DeviceTab[];
  windowId: number | undefined;
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
  // PocketBase number fields read back 0 when unset.
  const windowId = record.destinationWindowId;

  return {
    destination: record.destination?.trim() || null,
    ...(windowId && windowId > 0 ? { destinationWindowId: windowId } : {}),
    id: `shared:${record.id}`,
    searchable: `shared links ${source} ${title} ${record.url}`.toLocaleLowerCase(),
    source,
    title,
    url: record.url,
  };
}

export function groupSharedLinksByDestination(tabs: DeviceTab[]): Device[] {
  const groups = new Map<string, SharedLinkGroup>();

  for (const tab of tabs) {
    const destination = tab.destination?.trim() || "";
    const destinationKey = destination.toLocaleLowerCase();
    const windowId = tab.destinationWindowId;
    const key = JSON.stringify([destinationKey, windowId ?? null]);
    const group = groups.get(key);

    if (group) {
      group.tabs.push(tab);
      continue;
    }

    groups.set(key, { destination, destinationKey, tabs: [tab], windowId });
  }

  const destinationBucketCounts = countDestinationBuckets(groups.values());
  const windowRanks = getWindowRanks(groups.values());

  return [...groups.values()]
    .sort((left, right) => compareSharedLinkGroups(left, right, windowRanks))
    .map((group) => ({
      id: getSharedLinkGroupId(group),
      name: getSharedLinkGroupName(group, destinationBucketCounts, windowRanks),
      tabs: group.tabs,
    }));
}

function countDestinationBuckets(groups: Iterable<SharedLinkGroup>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const group of groups) {
    counts.set(group.destinationKey, (counts.get(group.destinationKey) ?? 0) + 1);
  }
  return counts;
}

function getWindowRanks(groups: Iterable<SharedLinkGroup>): Map<number, number> {
  const windowIds = new Set<number>();
  for (const group of groups) {
    if (group.windowId !== undefined) {
      windowIds.add(group.windowId);
    }
  }

  const ranks = new Map<number, number>();
  [...windowIds]
    .sort((left, right) => left - right)
    .forEach((windowId, index) => {
      ranks.set(windowId, index + 1);
    });
  return ranks;
}

function compareSharedLinkGroups(
  left: SharedLinkGroup,
  right: SharedLinkGroup,
  windowRanks: ReadonlyMap<number, number>,
): number {
  const leftUndirected = left.destinationKey === "";
  const rightUndirected = right.destinationKey === "";
  if (leftUndirected !== rightUndirected) {
    return leftUndirected ? -1 : 1;
  }

  const titleComparison = left.destinationKey.localeCompare(right.destinationKey);
  if (titleComparison !== 0) {
    return titleComparison;
  }

  if (left.windowId === undefined || right.windowId === undefined) {
    if (left.windowId === right.windowId) {
      return 0;
    }
    return left.windowId === undefined ? -1 : 1;
  }

  return (windowRanks.get(left.windowId) ?? 0) - (windowRanks.get(right.windowId) ?? 0);
}

function getSharedLinkGroupName(
  group: SharedLinkGroup,
  destinationBucketCounts: ReadonlyMap<string, number>,
  windowRanks: ReadonlyMap<number, number>,
): string {
  if (!group.destination) {
    if (group.windowId === undefined) {
      return "Shared Links";
    }
    const windowRank = windowRanks.get(group.windowId);
    return windowRank === undefined ? "Shared Links" : `Shared Links · Window ${windowRank}`;
  }

  const hasCollision = (destinationBucketCounts.get(group.destinationKey) ?? 0) > 1;
  if (!hasCollision || group.windowId === undefined) {
    return group.destination;
  }

  const windowRank = windowRanks.get(group.windowId);
  return windowRank === undefined
    ? group.destination
    : `${group.destination} · Window ${windowRank}`;
}

function getSharedLinkGroupId(group: SharedLinkGroup): string {
  const baseId = `shared-links:${group.destination ? slug(group.destination) : "none"}`;
  return group.windowId === undefined ? baseId : `${baseId}:w${group.windowId}`;
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
  liveWindowIds: ReadonlySet<number>,
): TabDestination {
  if (!tab.destination) {
    // A windowed no-group link opens ungrouped in its target window; a
    // stale window falls back to the current one.
    const requestedWindowId = tab.destinationWindowId;
    const windowId =
      requestedWindowId !== undefined && liveWindowIds.has(requestedWindowId)
        ? requestedWindowId
        : defaultWindowId;
    return { groupId: null, newGroupTitle: null, windowId };
  }

  const trimmedDestination = tab.destination.trim();
  const target = trimmedDestination.toLocaleLowerCase();
  const matchesTitle = (group: chrome.tabGroups.TabGroup) =>
    group.title?.trim().toLocaleLowerCase() === target;

  const requestedWindowId = tab.destinationWindowId;
  if (requestedWindowId !== undefined) {
    const exact = liveGroups.find(
      (group) => group.windowId === requestedWindowId && matchesTitle(group),
    );
    if (exact) {
      return { groupId: exact.id, newGroupTitle: null, windowId: exact.windowId };
    }
    if (liveWindowIds.has(requestedWindowId)) {
      return { groupId: null, newGroupTitle: trimmedDestination, windowId: requestedWindowId };
    }
    // The targeted window is gone; fall back to title-only routing below.
  }

  const match = liveGroups.find(matchesTitle);
  return match
    ? { groupId: match.id, newGroupTitle: null, windowId: match.windowId }
    : { groupId: null, newGroupTitle: trimmedDestination, windowId: defaultWindowId };
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
