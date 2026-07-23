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

export async function openTabsInBrowser(tabs: DeviceTab[]): Promise<void> {
  if (tabs.length === 0) {
    return;
  }

  const currentWindowId = await getCurrentWindowId();
  const liveGroups = chrome.tabGroups?.query ? await chrome.tabGroups.query({}) : [];
  const firstTab = await createBrowserTabs(tabs, currentWindowId, liveGroups);

  try {
    await markSharedLinksOpened(tabs);
  } catch (error) {
    await activateFirstTab(firstTab, currentWindowId);
    throw new OpenedTabsCleanupError(error);
  }
  await recordOpenedBatch(tabs);
  await activateFirstTab(firstTab, currentWindowId);
}

async function createBrowserTabs(
  tabs: DeviceTab[],
  defaultWindowId: number,
  liveGroups: chrome.tabGroups.TabGroup[],
): Promise<FirstCreatedTab> {
  let firstTab: FirstCreatedTab | null = null;
  // Tracks new groups created within this batch, keyed by lower-cased title,
  // so multiple tabs sharing an unmatched destination land in one group
  // instead of each creating their own.
  const newGroupIdsByTitle = new Map<string, number>();

  for (const tab of tabs) {
    const destination = resolveTabDestination(tab, defaultWindowId, liveGroups);
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
    } else if (destination.newGroupTitle !== null) {
      await addTabToNewGroup(created.id, destination.newGroupTitle, newGroupIdsByTitle);
    }
    firstTab ??= { id: created.id, windowId: destination.windowId };
  }

  if (!firstTab) {
    throw new Error("No browser tabs were created.");
  }
  return firstTab;
}

async function addTabToNewGroup(
  tabId: number,
  title: string,
  newGroupIdsByTitle: Map<string, number>,
): Promise<void> {
  const key = title.toLocaleLowerCase();
  const existingGroupId = newGroupIdsByTitle.get(key);
  if (existingGroupId !== undefined) {
    await chrome.tabs.group({ groupId: existingGroupId, tabIds: [tabId] });
    return;
  }

  const groupId = await chrome.tabs.group({ tabIds: [tabId] });
  newGroupIdsByTitle.set(key, groupId);
  await chrome.tabGroups.update(groupId, { title });
}

async function activateFirstTab(firstTab: FirstCreatedTab, currentWindowId: number): Promise<void> {
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
