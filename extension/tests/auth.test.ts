import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshSession } from "../src/popup/auth";

describe("refreshSession", () => {
  const fetchMock = vi.fn();
  const storageGetMock = vi.fn(async () => ({
    pocketbaseServerUrl: "https://pocketbase.test",
    pocketbaseToken: "stored-token",
  }));
  const storageSetMock = vi.fn(async () => undefined);

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("chrome", {
      storage: { local: { get: storageGetMock, set: storageSetMock } },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("persists the rotated token and reports a valid session", async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({ token: "rotated-token" }),
      ok: true,
    });

    await expect(refreshSession()).resolves.toBe("valid");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://pocketbase.test/api/collections/users/auth-refresh",
      { headers: { Authorization: "stored-token" }, method: "POST" },
    );
    expect(storageSetMock).toHaveBeenCalledWith({ pocketbaseToken: "rotated-token" });
  });

  it("reports an expired session on 401 without touching the stored token", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 });

    await expect(refreshSession()).resolves.toBe("expired");
    expect(storageSetMock).not.toHaveBeenCalled();
  });

  it("treats server errors as unreachable rather than expired", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    await expect(refreshSession()).resolves.toBe("unreachable");
    expect(storageSetMock).not.toHaveBeenCalled();
  });

  it("treats a network failure as unreachable rather than expired", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(refreshSession()).resolves.toBe("unreachable");
    expect(storageSetMock).not.toHaveBeenCalled();
  });

  it("reports notConfigured without a server request when config is missing", async () => {
    storageGetMock.mockResolvedValueOnce({
      pocketbaseServerUrl: "",
      pocketbaseToken: "",
    });

    await expect(refreshSession()).resolves.toBe("notConfigured");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
