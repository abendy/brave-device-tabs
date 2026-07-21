import { STORAGE_KEYS } from "../shared/storage-keys";
import type { DeviceTab, OpenedBatch } from "./types";

const OPENED_HISTORY_KEY = "openedHistory";
const MAX_OPENED_BATCHES = 50;

export interface ServerConfig {
  serverUrl: string | null;
  token: string | null;
}

export async function readServerConfig(): Promise<ServerConfig> {
  const values = await chrome.storage.local.get([STORAGE_KEYS.serverUrl, STORAGE_KEYS.token]);
  return {
    serverUrl: getString(values[STORAGE_KEYS.serverUrl]),
    token: getString(values[STORAGE_KEYS.token]),
  };
}

export async function loadOpenedHistory(): Promise<OpenedBatch[]> {
  const values = await chrome.storage.local.get(OPENED_HISTORY_KEY);
  const history: unknown = values[OPENED_HISTORY_KEY];
  return Array.isArray(history) ? (history as OpenedBatch[]) : [];
}

export async function recordOpenedBatch(tabs: DeviceTab[]): Promise<OpenedBatch[]> {
  const history = await loadOpenedHistory();
  const batch: OpenedBatch = {
    id: `${Date.now()}`,
    items: tabs.map((tab) => ({
      id: tab.id,
      source: tab.source,
      title: tab.title,
      url: tab.url,
    })),
    openedAt: new Date().toISOString(),
  };

  const updated = [batch, ...history].slice(0, MAX_OPENED_BATCHES);
  await chrome.storage.local.set({ [OPENED_HISTORY_KEY]: updated });
  return updated;
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}
