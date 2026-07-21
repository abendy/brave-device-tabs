import { normalizeDevices } from "./domain";
import type { LoadSyncedDevicesResult } from "./types";

const SYNC_ERROR_MESSAGE =
  "Could not read synced tabs. Confirm Brave Sync is enabled and “Open Tabs” is selected on both devices.";

export async function loadSyncedDevices(): Promise<LoadSyncedDevicesResult> {
  try {
    if (!chrome.sessions?.getDevices) {
      throw new Error("This browser does not expose the synced-sessions API.");
    }
    return { devices: normalizeDevices(await getSyncedDevices()), error: null };
  } catch (error) {
    console.error("Unable to load synced device tabs:", error);
    return { devices: [], error: SYNC_ERROR_MESSAGE };
  }
}

function getSyncedDevices(): Promise<chrome.sessions.Device[]> {
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
