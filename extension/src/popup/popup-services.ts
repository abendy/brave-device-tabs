import { refreshSession, type SessionState } from "./auth";
import { deleteSharedLink, loadSharedLinksDevices, syncTabGroupsToServer } from "./shared-links";
import { loadOpenedHistory } from "./storage";
import { loadSyncedDevices } from "./synced-devices";
import { openTabsInBrowser } from "./tab-opener";
import type { Device, DeviceTab, LoadSyncedDevicesResult, OpenedBatch } from "./types";

export interface PopupServices {
  deleteSharedLink(tabId: string): Promise<boolean>;
  loadOpenedHistory(): Promise<OpenedBatch[]>;
  loadSharedLinksDevices(): Promise<Device[]>;
  loadSyncedDevices(): Promise<LoadSyncedDevicesResult>;
  openOptionsPage(): void;
  openTabs(tabs: DeviceTab[]): Promise<void>;
  refreshSession(): Promise<SessionState>;
  syncTabGroupsToServer(): Promise<void>;
}

export const popupServices: PopupServices = {
  deleteSharedLink,
  loadOpenedHistory,
  loadSharedLinksDevices,
  loadSyncedDevices,
  openOptionsPage: () => chrome.runtime.openOptionsPage(),
  openTabs: openTabsInBrowser,
  refreshSession,
  syncTabGroupsToServer,
};
