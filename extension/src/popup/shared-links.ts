import {
  groupSharedLinksByDestination,
  isOpenableUrl,
  normalizeSharedLink,
  type SharedLinkRecord,
} from "./domain";
import { readServerConfig } from "./storage";
import type { Device, DeviceTab } from "./types";

interface ListResponse<Item> {
  page?: number;
  perPage?: number;
  totalItems?: number;
  totalPages?: number;
  items?: Item[];
}

const MAX_SHARED_LINK_PAGES = 20;

export const BROWSER_GROUPS_RECORD_ID = "browsergroups01";

export async function loadSharedLinksDevices(): Promise<Device[]> {
  try {
    const { serverUrl, token } = await readServerConfig();
    if (!serverUrl || !token) {
      return [];
    }

    const baseQuery = `filter=${encodeURIComponent("(opened=false)")}&sort=-created`;
    const records: SharedLinkRecord[] = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages && page <= MAX_SHARED_LINK_PAGES) {
      const query = `${baseQuery}&perPage=200&page=${page}`;
      const response = await fetch(`${serverUrl}/api/collections/shared_links/records?${query}`, {
        headers: { Authorization: token },
      });
      if (!response.ok) {
        throw new Error(`Shared Links request failed (${response.status}).`);
      }

      const data = (await response.json()) as ListResponse<SharedLinkRecord>;
      records.push(...(data.items ?? []));
      totalPages = data.totalPages ?? page;
      page += 1;
    }

    if (page <= totalPages) {
      console.warn(`Shared Links pagination stopped after ${MAX_SHARED_LINK_PAGES} pages.`);
    }

    const tabs = records
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
  await backfillPinnedGroupColors(serverUrl, token, groups);
}

/// The browser is the color authority: pins remember their group's Chrome
/// color so a pinned destination keeps its dot after the live group closes.
/// Each sync copies the color of a pin's matching live group (same title;
/// same window preferred) onto pins whose stored color differs.
/// Best-effort like healing.
async function backfillPinnedGroupColors(
  serverUrl: string,
  token: string,
  liveGroups: Array<{ color: string; title: string; windowId: number }>,
): Promise<void> {
  try {
    const response = await fetch(`${serverUrl}/api/collections/pinned_groups/records?perPage=200`, {
      headers: { Authorization: token },
    });
    if (!response.ok) {
      return;
    }
    const data = (await response.json()) as ListResponse<{
      color?: string;
      id: string;
      title?: string;
      windowId?: number;
    }>;
    for (const pin of data.items ?? []) {
      const key = pin.title?.trim().toLocaleLowerCase();
      if (!key) {
        continue;
      }
      const matches = liveGroups.filter((group) => group.title.trim().toLocaleLowerCase() === key);
      const match = matches.find((group) => group.windowId === pin.windowId) ?? matches[0];
      if (!match || match.color === pin.color) {
        continue;
      }
      const patch = await fetch(`${serverUrl}/api/collections/pinned_groups/records/${pin.id}`, {
        body: JSON.stringify({ color: match.color }),
        headers: { Authorization: token, "Content-Type": "application/json" },
        method: "PATCH",
      });
      if (!patch.ok) {
        throw new Error(`Backfilling pin color for ${pin.id} failed (${patch.status}).`);
      }
    }
  } catch (error) {
    console.warn("Pin color backfill skipped:", error);
  }
}

/// Browser restarts reassign window ids, stranding pinned groups and
/// windowed links on ids that no longer exist. The previous snapshot still
/// knows which group titles each vanished window held, so its windows are
/// fingerprinted and matched to live windows; server records pointing at a
/// vanished id are patched over to its successor. Best-effort: a failure
/// leaves records as they were, and the stale ids still degrade gracefully
/// at open time.
async function healStaleWindowReferences(
  serverUrl: string,
  token: string,
  previousResponse: Response,
  liveGroups: Array<{ title: string; windowId: number }>,
): Promise<void> {
  try {
    const record = (await previousResponse.json()) as {
      groups?: Array<{ title?: string; windowId?: number }>;
    };
    const previous = (record.groups ?? []).flatMap((group) =>
      group.title && typeof group.windowId === "number"
        ? [{ title: group.title, windowId: group.windowId }]
        : [],
    );

    for (const [staleId, successorId] of mapStaleWindows(previous, liveGroups)) {
      await retargetCollection(serverUrl, token, "pinned_groups", "windowId", staleId, successorId);
      await retargetCollection(
        serverUrl,
        token,
        "shared_links",
        "destinationWindowId",
        staleId,
        successorId,
        "opened=false && ",
      );
    }
  } catch (error) {
    console.warn("Stale window healing skipped:", error);
  }
}

/// Maps each vanished window id to the live window that best matches its
/// group-title fingerprint. Scored by overlap coefficient (shared titles
/// over the smaller fingerprint) so a window that gained or lost groups
/// since the snapshot still matches; at least half of the smaller
/// fingerprint must persist, and each live window is claimed at most once.
export function mapStaleWindows(
  previous: Array<{ title: string; windowId: number }>,
  live: Array<{ title: string; windowId: number }>,
): Map<number, number> {
  const staleTitles = titlesByWindow(previous);
  const liveTitles = titlesByWindow(live);
  for (const windowId of liveTitles.keys()) {
    staleTitles.delete(windowId);
  }

  const candidates: Array<{ staleId: number; liveId: number; shared: number; score: number }> = [];
  for (const [staleId, stale] of staleTitles) {
    for (const [liveId, liveSet] of liveTitles) {
      let shared = 0;
      for (const title of stale) {
        if (liveSet.has(title)) {
          shared += 1;
        }
      }
      if (shared === 0) {
        continue;
      }
      candidates.push({
        liveId,
        score: shared / Math.min(stale.size, liveSet.size),
        shared,
        staleId,
      });
    }
  }
  candidates.sort(
    (left, right) =>
      right.score - left.score ||
      right.shared - left.shared ||
      left.staleId - right.staleId ||
      left.liveId - right.liveId,
  );

  const mapping = new Map<number, number>();
  const claimed = new Set<number>();
  for (const candidate of candidates) {
    if (candidate.score < 0.5) {
      break;
    }
    if (mapping.has(candidate.staleId) || claimed.has(candidate.liveId)) {
      continue;
    }
    mapping.set(candidate.staleId, candidate.liveId);
    claimed.add(candidate.liveId);
  }
  return mapping;
}

function titlesByWindow(
  groups: Array<{ title: string; windowId: number }>,
): Map<number, Set<string>> {
  const titles = new Map<number, Set<string>>();
  for (const group of groups) {
    const title = group.title.trim().toLocaleLowerCase();
    if (!title) {
      continue;
    }
    const existing = titles.get(group.windowId) ?? new Set<string>();
    existing.add(title);
    titles.set(group.windowId, existing);
  }
  return titles;
}

async function retargetCollection(
  serverUrl: string,
  token: string,
  collection: string,
  field: string,
  staleId: number,
  successorId: number,
  extraFilter = "",
): Promise<void> {
  const filter = encodeURIComponent(`(${extraFilter}${field}=${staleId})`);
  const response = await fetch(
    `${serverUrl}/api/collections/${collection}/records?filter=${filter}&fields=id&perPage=200`,
    { headers: { Authorization: token } },
  );
  if (!response.ok) {
    throw new Error(`Loading ${collection} for window healing failed (${response.status}).`);
  }
  const data = (await response.json()) as ListResponse<{ id: string }>;
  for (const item of data.items ?? []) {
    const patch = await fetch(`${serverUrl}/api/collections/${collection}/records/${item.id}`, {
      body: JSON.stringify({ [field]: successorId }),
      headers: { Authorization: token, "Content-Type": "application/json" },
      method: "PATCH",
    });
    if (!patch.ok) {
      throw new Error(`Retargeting ${collection} ${item.id} failed (${patch.status}).`);
    }
  }
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
    // Heal before the write replaces the previous snapshot — it is the
    // only remaining record of what the vanished windows held.
    await healStaleWindowReferences(serverUrl, token, response, groups);
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
