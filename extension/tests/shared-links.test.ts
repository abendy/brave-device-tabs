import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markSharedLinksOpened } from "../src/popup/shared-links";

describe("markSharedLinksOpened", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async () => ({
            pocketbaseServerUrl: "https://pocketbase.test",
            pocketbaseToken: "token",
          })),
        },
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("rejects when PocketBase does not accept the opened update", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403 });

    await expect(
      markSharedLinksOpened([
        {
          destination: null,
          id: "shared:record-id",
          searchable: "saved link",
          source: "Phone",
          title: "Saved link",
          url: "https://example.test",
        },
      ]),
    ).rejects.toThrow("Marking shared link record-id opened failed (403).");
  });
});
