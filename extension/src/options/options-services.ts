import { STORAGE_KEYS } from "../shared/storage-keys";
import { login } from "./server";

export interface OptionsServices {
  connect(serverUrl: string, email: string, password: string): Promise<void>;
  disconnect(): Promise<void>;
  loadServerUrl(): Promise<string | null>;
}

async function loadServerUrl(): Promise<string | null> {
  const values = await chrome.storage.local.get(STORAGE_KEYS.serverUrl);
  const serverUrl: unknown = values[STORAGE_KEYS.serverUrl];
  return typeof serverUrl === "string" && serverUrl ? serverUrl : null;
}

async function connect(serverUrl: string, email: string, password: string): Promise<void> {
  // Keep this as the first awaited operation. Chromium only permits an
  // optional-host request while the form submission's user gesture is active.
  const origin = new URL(serverUrl).origin;
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
  if (!granted) {
    throw new Error("Permission to contact that server was not granted.");
  }

  const token = await login(serverUrl, email, password);
  await chrome.storage.local.set({
    [STORAGE_KEYS.serverUrl]: serverUrl,
    [STORAGE_KEYS.token]: token,
  });
}

async function disconnect(): Promise<void> {
  const serverUrl = await loadServerUrl();
  await chrome.storage.local.remove([STORAGE_KEYS.serverUrl, STORAGE_KEYS.token]);
  if (!serverUrl) {
    return;
  }

  try {
    const origin = new URL(serverUrl).origin;
    await chrome.permissions.remove({ origins: [`${origin}/*`] });
  } catch (error) {
    console.warn("Could not release host permission:", error);
  }
}

export const optionsServices: OptionsServices = {
  connect,
  disconnect,
  loadServerUrl,
};
