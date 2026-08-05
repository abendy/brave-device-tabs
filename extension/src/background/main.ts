import { refreshSession } from "../popup/auth";
import { syncTabGroupsToServer } from "../popup/shared-links";

export const TAB_GROUP_SYNC_DEBOUNCE_MS = 2_000;

let debounceTimer: ReturnType<typeof setTimeout> | undefined;

export function scheduleTabGroupSync(): void {
  if (debounceTimer !== undefined) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    debounceTimer = undefined;
    startBackgroundSync();
  }, TAB_GROUP_SYNC_DEBOUNCE_MS);
}

export async function runBackgroundSync(): Promise<void> {
  const session = await refreshSession();
  if (session === "unreachable") {
    console.warn("Unable to refresh the session for background tab-group sync.");
    return;
  }
  if (session !== "valid") {
    return;
  }

  await syncTabGroupsToServer();
}

function startBackgroundSync(): void {
  void runBackgroundSync().catch((error: unknown) => {
    console.warn("Background tab-group sync failed:", error);
  });
}

export function registerBackgroundListeners(): void {
  chrome.tabGroups.onCreated.addListener(scheduleTabGroupSync);
  chrome.tabGroups.onMoved.addListener(scheduleTabGroupSync);
  chrome.tabGroups.onRemoved.addListener(scheduleTabGroupSync);
  chrome.tabGroups.onUpdated.addListener(scheduleTabGroupSync);
  chrome.tabs.onAttached.addListener(scheduleTabGroupSync);
  chrome.tabs.onDetached.addListener(scheduleTabGroupSync);
  chrome.tabs.onMoved.addListener(scheduleTabGroupSync);
  chrome.runtime.onInstalled.addListener(startBackgroundSync);
  chrome.runtime.onStartup.addListener(startBackgroundSync);
}

if (typeof chrome !== "undefined") {
  registerBackgroundListeners();
}
