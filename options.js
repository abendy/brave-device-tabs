"use strict";

const elements = {
  form: document.querySelector("#setup-form"),
  serverUrl: document.querySelector("#server-url"),
  email: document.querySelector("#email"),
  password: document.querySelector("#password"),
  signInButton: document.querySelector("#sign-in-button"),
  connectedPanel: document.querySelector("#connected-panel"),
  connectedUrl: document.querySelector("#connected-url"),
  signOutButton: document.querySelector("#sign-out-button"),
  status: document.querySelector("#status"),
};

document.addEventListener("DOMContentLoaded", initialize);

async function initialize() {
  elements.form.addEventListener("submit", handleSignIn);
  elements.signOutButton.addEventListener("click", handleSignOut);
  await render();
}

async function render() {
  const { [STORAGE_KEYS.serverUrl]: serverUrl } = await chrome.storage.local.get(STORAGE_KEYS.serverUrl);

  if (serverUrl) {
    elements.connectedUrl.textContent = serverUrl;
    elements.connectedPanel.hidden = false;
    elements.form.hidden = true;
  } else {
    elements.connectedPanel.hidden = true;
    elements.form.hidden = false;
  }
}

async function handleSignIn(event) {
  event.preventDefault();
  hideStatus();

  const rawUrl = elements.serverUrl.value.trim();
  const email = elements.email.value.trim();
  const password = elements.password.value;

  let serverUrl;
  try {
    serverUrl = normalizeServerUrl(rawUrl);
  } catch {
    showStatus("Enter a valid server URL, e.g. https://your-app.fly.dev", true);
    return;
  }

  elements.signInButton.disabled = true;
  elements.signInButton.textContent = "Signing in…";

  try {
    // Must come before any other await so the permission prompt is still
    // tied to this submit click - Chromium requires optional_host_permissions
    // requests to happen within a user gesture's call stack.
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

    elements.password.value = "";
    await render();
  } catch (error) {
    console.error("Sign-in failed:", error);
    showStatus(error.message || "Sign-in failed.", true);
  } finally {
    elements.signInButton.disabled = false;
    elements.signInButton.textContent = "Sign In";
  }
}

async function handleSignOut() {
  const { [STORAGE_KEYS.serverUrl]: serverUrl } = await chrome.storage.local.get(STORAGE_KEYS.serverUrl);

  await chrome.storage.local.remove([STORAGE_KEYS.serverUrl, STORAGE_KEYS.token]);

  if (serverUrl) {
    try {
      const origin = new URL(serverUrl).origin;
      await chrome.permissions.remove({ origins: [`${origin}/*`] });
    } catch (error) {
      console.warn("Could not release host permission:", error);
    }
  }

  await render();
}

async function login(serverUrl, email, password) {
  const response = await fetch(`${serverUrl}/api/collections/users/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: email, password }),
  });

  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw new Error(message || `Sign-in failed (${response.status}).`);
  }

  const data = await response.json();
  if (!data.token) {
    throw new Error("Server response did not include a token.");
  }

  return data.token;
}

async function readErrorMessage(response) {
  try {
    const data = await response.json();
    return data.message;
  } catch {
    return null;
  }
}

function normalizeServerUrl(rawUrl) {
  const withScheme = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  const url = new URL(withScheme);
  return url.origin;
}

function showStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("error", isError);
  elements.status.hidden = false;
}

function hideStatus() {
  elements.status.hidden = true;
  elements.status.textContent = "";
  elements.status.classList.remove("error");
}
