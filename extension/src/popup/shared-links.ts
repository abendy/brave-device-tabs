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

export const BROWSER_GROUPS_RECORD_ID = "browsergroups01";

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

let syncQueue: Promise<void> = Promise.resolve();

export function syncTabGroupsToServer(): Promise<void> {
  const run = syncQueue.then(() => performTabGroupSync());
  // Keep later passes moving after a failed sync while preserving this
  // caller's rejection through the separately returned `run` promise.
  syncQueue = run.catch(() => undefined);
  return run;
}

async function performTabGroupSync(): Promise<void> {
  const { serverUrl, token } = await readServerConfig();
  if (!serverUrl || !token || !chrome.tabGroups?.query) {
    return;
  }

  const [liveGroups, tabs] = await Promise.all([chrome.tabGroups.query({}), chrome.tabs.query({})]);
  const firstTabIndexByGroup = new Map<number, number>();
  for (const tab of tabs) {
    if (tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
      continue;
    }
    const currentIndex = firstTabIndexByGroup.get(tab.groupId);
    if (currentIndex === undefined || tab.index < currentIndex) {
      firstTabIndexByGroup.set(tab.groupId, tab.index);
    }
  }

  const groups = liveGroups.flatMap((group) => {
    const title = group.title?.trim();
    return title
      ? [
          {
            color: group.color,
            index: firstTabIndexByGroup.get(group.id) ?? 0,
            title,
            windowId: group.windowId,
          },
        ]
      : [];
  });
  await writeTabGroups(serverUrl, token, groups);
}

async function writeTabGroups(
  serverUrl: string,
  token: string,
  groups: Array<{
    color: chrome.tabGroups.TabGroup["color"];
    index: number;
    title: string;
    windowId: number;
  }>,
): Promise<void> {
  const collectionUrl = `${serverUrl}/api/collections/browser_groups/records`;
  const recordUrl = `${collectionUrl}/${BROWSER_GROUPS_RECORD_ID}`;
  const response = await fetch(recordUrl, {
    headers: { Authorization: token },
  });
  if (response.ok) {
    await patchTabGroups(recordUrl, token, groups);
    return;
  }
  if (response.status !== 404) {
    throw await pocketBaseResponseError(response, "Loading tab groups");
  }

  const createResponse = await fetch(collectionUrl, {
    body: JSON.stringify({ groups, id: BROWSER_GROUPS_RECORD_ID }),
    headers: { Authorization: token, "Content-Type": "application/json" },
    method: "POST",
  });
  if (createResponse.ok) {
    return;
  }

  let retryResponse: Response | undefined;
  try {
    retryResponse = await fetch(recordUrl, {
      headers: { Authorization: token },
    });
  } catch {
    // Preserve the original create failure when the race check is unreachable.
  }
  if (!retryResponse?.ok) {
    throw await pocketBaseResponseError(createResponse, "Syncing tab groups");
  }
  await patchTabGroups(recordUrl, token, groups);
}

async function patchTabGroups(
  recordUrl: string,
  token: string,
  groups: Array<{
    color: chrome.tabGroups.TabGroup["color"];
    index: number;
    title: string;
    windowId: number;
  }>,
): Promise<void> {
  const response = await fetch(recordUrl, {
    body: JSON.stringify({ groups }),
    headers: { Authorization: token, "Content-Type": "application/json" },
    method: "PATCH",
  });
  if (!response.ok) {
    throw await pocketBaseResponseError(response, "Syncing tab groups");
  }
}

async function pocketBaseResponseError(response: Response, action: string): Promise<Error> {
  let detail = "";
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === "string" && body.message.trim()) {
      detail = ` ${body.message.trim()}`;
    }
  } catch {
    // PocketBase can return an empty or non-JSON error body.
  }
  return new Error(`${action} failed (${response.status}).${detail}`);
}
