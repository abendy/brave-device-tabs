import { readServerConfig, writeToken } from "./storage";

export type SessionState = "valid" | "expired" | "unreachable" | "notConfigured";

interface RefreshResponse {
  token?: string;
}

/**
 * PocketBase list rules act as filters for requests whose token is dead:
 * reads come back 200 with empty items, never 401, so no fetch in this popup
 * can reveal an expired session on its own. This explicit refresh is the only
 * reliable check, and a successful one rotates the stored token so regular
 * use keeps the session alive. Only 401/403 means expired — network failures
 * must stay distinguishable so offline is not treated as signed out.
 */
export async function refreshSession(): Promise<SessionState> {
  const { serverUrl, token } = await readServerConfig();
  if (!serverUrl || !token) {
    return "notConfigured";
  }

  try {
    const response = await fetch(`${serverUrl}/api/collections/users/auth-refresh`, {
      headers: { Authorization: token },
      method: "POST",
    });
    if (response.ok) {
      const data = (await response.json()) as RefreshResponse;
      if (typeof data.token === "string" && data.token) {
        await writeToken(data.token);
      }
      return "valid";
    }
    return response.status === 401 || response.status === 403 ? "expired" : "unreachable";
  } catch {
    return "unreachable";
  }
}
