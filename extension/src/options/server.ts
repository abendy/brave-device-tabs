const HTTP_SCHEME = /^https?:\/\//i;

interface LoginResponse {
  token?: string;
}

interface ErrorResponse {
  message?: string;
}

export function normalizeServerUrl(rawUrl: string): string {
  const withScheme = HTTP_SCHEME.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  return new URL(withScheme).origin;
}

export async function login(serverUrl: string, email: string, password: string): Promise<string> {
  const response = await fetch(`${serverUrl}/api/collections/users/auth-with-password`, {
    body: JSON.stringify({ identity: email, password }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw new Error(message || `Sign-in failed (${response.status}).`);
  }

  const data = (await response.json()) as LoginResponse;
  if (!data.token) {
    throw new Error("Server response did not include a token.");
  }
  return data.token;
}

async function readErrorMessage(response: Response): Promise<string | null> {
  try {
    const data = (await response.json()) as ErrorResponse;
    return data.message ?? null;
  } catch {
    return null;
  }
}
