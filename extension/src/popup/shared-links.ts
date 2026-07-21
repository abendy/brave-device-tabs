import {
  groupSharedLinksByDestination,
  isOpenableUrl,
  normalizeSharedLink,
  type SharedLinkRecord,
} from "./domain";
import { readServerConfig } from "./storage";
import type { Device, DeviceTab } from "./types";

interface ListResponse<Item> {
  items?: Item[];
}

interface BrowserGroupRecord {
  id: string;
}

export async function loadSharedLinksDevices(): Promise<Device[]> {
  try {
    const { serverUrl, token } = await readServerConfig();
    if (!serverUrl || !token) {
      return [];
    }

    const query = `filter=${encodeURIComponent("(opened=false)")}&sort=-created`;
    const response = await fetch(`${serverUrl}/api/collections/shared_links/records?${query}`, {
      headers: { Authorization: token },
    });
    if (!response.ok) {
      throw new Error(`Shared Links request failed (${response.status}).`);
    }

    const data = (await response.json()) as ListResponse<SharedLinkRecord>;
    const tabs = (data.items ?? [])
      .map(normalizeSharedLink)
      .filter((tab) => tab.url && isOpenableUrl(tab.url));
    return groupSharedLinksByDestination(tabs);
  } catch (error) {
    console.warn("Unable to load shared links:", error);
    return [];
  }
}

export async function deleteSharedLink(tabId: string): Promise<boolean> {
  const { serverUrl, token } = await readServerConfig();
  if (!serverUrl || !token) {
    return false;
  }

  const recordId = tabId.slice("shared:".length);
  const response = await fetch(`${serverUrl}/api/collections/shared_links/records/${recordId}`, {
    headers: { Authorization: token },
    method: "DELETE",
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Delete failed (${response.status}).`);
  }
  return true;
}

export async function markSharedLinksOpened(tabs: DeviceTab[]): Promise<void> {
  const sharedIds = tabs
    .filter((tab) => tab.id.startsWith("shared:"))
    .map((tab) => tab.id.slice("shared:".length));
  if (sharedIds.length === 0) {
    return;
  }

  const { serverUrl, token } = await readServerConfig();
  if (!serverUrl || !token) {
    throw new Error("The Shared Links server is not configured.");
  }

  await Promise.all(sharedIds.map((id) => markSharedLinkOpened(serverUrl, token, id)));
}

async function markSharedLinkOpened(serverUrl: string, token: string, id: string): Promise<void> {
  const response = await fetch(`${serverUrl}/api/collections/shared_links/records/${id}`, {
    body: JSON.stringify({ opened: true }),
    headers: { Authorization: token, "Content-Type": "application/json" },
    method: "PATCH",
  });
  if (!response.ok) {
    throw new Error(`Marking shared link ${id} opened failed (${response.status}).`);
  }
}

export async function syncTabGroupsToServer(): Promise<void> {
  try {
    const { serverUrl, token } = await readServerConfig();
    if (!serverUrl || !token || !chrome.tabGroups?.query) {
      return;
    }

    const groups = (await chrome.tabGroups.query({})).flatMap((group) => {
      const title = group.title?.trim();
      return title ? [{ color: group.color, title }] : [];
    });
    await writeTabGroups(serverUrl, token, groups);
  } catch (error) {
    console.warn("Unable to sync tab groups:", error);
  }
}

async function writeTabGroups(
  serverUrl: string,
  token: string,
  groups: Array<{ color: chrome.tabGroups.TabGroup["color"]; title: string }>,
): Promise<void> {
  const collectionUrl = `${serverUrl}/api/collections/browser_groups/records`;
  const response = await fetch(`${collectionUrl}?perPage=1`, {
    headers: { Authorization: token },
  });
  const data = response.ok
    ? ((await response.json()) as ListResponse<BrowserGroupRecord>)
    : { items: [] };
  const record = data.items?.[0];

  await fetch(record ? `${collectionUrl}/${record.id}` : collectionUrl, {
    body: JSON.stringify({ groups }),
    headers: { Authorization: token, "Content-Type": "application/json" },
    method: record ? "PATCH" : "POST",
  });
}
