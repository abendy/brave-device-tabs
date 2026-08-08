import { resolveTabDestination } from "./domain";
import { markSharedLinksOpened } from "./shared-links";
import { recordOpenedBatch } from "./storage";
import type { DeviceTab } from "./types";

interface FirstCreatedTab {
  id: number;
  windowId: number;
}

export class OpenedTabsCleanupError extends Error {
  constructor(cause: unknown) {
    const detail = cause instanceof Error ? ` ${cause.message}` : "";
    super(`The tabs opened, but their shared links could not be cleared.${detail}`, { cause });
    this.name = "OpenedTabsCleanupError";
  }
}

export class OpenedTabsSyncError extends Error {
  constructor(cause: unknown) {
    const detail = cause instanceof Error ? ` ${cause.message}` : "";
    super(`The tabs opened, but their tab group snapshot could not be synced.${detail}`, { cause });
    this.name = "OpenedTabsSyncError";
  }
}

export async function openTabsInBrowser(
  tabs: DeviceTab[],
  syncTabGroups: (() => Promise<void>) | null,
): Promise<void> {
  if (tabs.length === 0) {
    return;
  }

  const currentWindowId = await getCurrentWindowId();
  const liveGroups = chrome.tabGroups?.query ? await chrome.tabGroups.query({}) : [];
  const liveWindows = await chrome.windows.getAll({});
  const liveWindowIds = new Set(
    liveWindows.map((window) => window.id).filter((id): id is number => id !== undefined),
  );
  // Tabs with a group destination append to it silently — no window focus,
  // no tab activation — so only the first ungrouped tab (which has no group
  // to be found in later) is worth surfacing.
  const firstTab = await createBrowserTabs(tabs, currentWindowId, liveGroups, liveWindowIds);

  let syncFailed = false;
  let syncError: unknown;
  if (syncTabGroups !== null) {
    try {
      await syncTabGroups();
    } catch (error) {
      syncFailed = true;
      syncError = error;
    }
  }

  try {
    await markSharedLinksOpened(tabs);
  } catch (error) {
    await activateFirstTab(firstTab, currentWindowId);
    throw new OpenedTabsCleanupError(error);
  }
  await recordOpenedBatch(tabs);
  await activateFirstTab(firstTab, currentWindowId);
  if (syncFailed) {
    throw new OpenedTabsSyncError(syncError);
  }
}

async function createBrowserTabs(
  tabs: DeviceTab[],
  defaultWindowId: number,
  liveGroups: chrome.tabGroups.TabGroup[],
  liveWindowIds: ReadonlySet<number>,
): Promise<FirstCreatedTab | null> {
  let firstUngroupedTab: FirstCreatedTab | null = null;
  // Tracks new groups created within this batch, keyed by window plus
  // lower-cased title, so multiple tabs sharing an unmatched destination
  // land in one group — while the same title aimed at two windows still
  // makes one group per window.
  const newGroupIdsByWindowAndTitle = new Map<string, number>();

  for (const tab of tabs) {
    const destination = resolveTabDestination(tab, defaultWindowId, liveGroups, liveWindowIds);
    const created = await chrome.tabs.create({
      active: false,
      url: tab.url,
      windowId: destination.windowId,
    });
    if (created.id === undefined) {
      throw new Error("The browser created a tab without an id.");
    }

    if (destination.groupId !== null) {
      await chrome.tabs.group({ groupId: destination.groupId, tabIds: [created.id] });
    } else if (destination.newGroupTitle === null) {
      firstUngroupedTab ??= { id: created.id, windowId: destination.windowId };
    } else {
      await addTabToNewGroup(
        created.id,
        destination.newGroupTitle,
        destination.windowId,
        newGroupIdsByWindowAndTitle,
      );
    }
  }

  return firstUngroupedTab;
}

async function addTabToNewGroup(
  tabId: number,
  title: string,
  windowId: number,
  newGroupIdsByWindowAndTitle: Map<string, number>,
): Promise<void> {
  const key = `${windowId}:${title.toLocaleLowerCase()}`;
  const existingGroupId = newGroupIdsByWindowAndTitle.get(key);
  if (existingGroupId !== undefined) {
    await chrome.tabs.group({ groupId: existingGroupId, tabIds: [tabId] });
    return;
  }

  // Explicitly keep the new group in the destination window; Chrome otherwise
  // defaults it to the current window.
  const groupId = await chrome.tabs.group({
    createProperties: { windowId },
    tabIds: [tabId],
  });
  newGroupIdsByWindowAndTitle.set(key, groupId);
  await chrome.tabGroups.update(groupId, { title });
}

async function activateFirstTab(
  firstTab: FirstCreatedTab | null,
  currentWindowId: number,
): Promise<void> {
  if (firstTab === null) {
    return;
  }
  if (firstTab.windowId !== currentWindowId) {
    await chrome.windows.update(firstTab.windowId, { focused: true });
  }
  await chrome.tabs.update(firstTab.id, { active: true });
}

function getCurrentWindowId(): Promise<number> {
  return new Promise((resolve, reject) => {
    chrome.windows.getCurrent({}, (currentWindow) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      if (currentWindow.id === undefined) {
        reject(new Error("Unable to identify the current browser window."));
        return;
      }
      resolve(currentWindow.id);
    });
  });
}
