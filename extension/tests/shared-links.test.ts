import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markSharedLinksOpened, syncTabGroupsToServer } from "../src/popup/shared-links";

describe("markSharedLinksOpened", () => {
  const fetchMock = vi.fn();
  const tabGroupsQueryMock = vi.fn<() => Promise<chrome.tabGroups.TabGroup[]>>(async () => []);
  const tabsQueryMock = vi.fn<() => Promise<chrome.tabs.Tab[]>>(async () => []);

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
      tabGroups: { query: tabGroupsQueryMock, TAB_GROUP_ID_NONE: -1 },
      tabs: { query: tabsQueryMock },
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

  it("syncs each tab group's window ID", async () => {
    tabGroupsQueryMock.mockResolvedValue([
      { collapsed: false, color: "blue", id: 1, shared: false, title: " Research ", windowId: 42 },
      { collapsed: true, color: "red", id: 2, shared: false, title: "Planning", windowId: 7 },
    ]);
    tabsQueryMock.mockResolvedValue([
      { groupId: 2, index: 8 } as chrome.tabs.Tab,
      { groupId: 1, index: 4 } as chrome.tabs.Tab,
      { groupId: 1, index: 5 } as chrome.tabs.Tab,
    ]);
    fetchMock
      .mockResolvedValueOnce({
        json: async () => ({ items: [{ id: "groups-record" }] }),
        ok: true,
      })
      .mockResolvedValueOnce({ ok: true });

    await syncTabGroupsToServer();

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://pocketbase.test/api/collections/browser_groups/records/groups-record",
      expect.objectContaining({
        body: JSON.stringify({
          groups: [
            { color: "blue", index: 4, title: "Research", windowId: 42 },
            { color: "red", index: 8, title: "Planning", windowId: 7 },
          ],
        }),
        method: "PATCH",
      }),
    );
  });

  it("rejects when loading the existing tab group snapshot fails", async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({ message: "The request requires valid authentication." }),
      ok: false,
      status: 401,
    });

    await expect(syncTabGroupsToServer()).rejects.toThrow(
      "Loading tab groups failed (401). The request requires valid authentication.",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects when updating the existing tab group snapshot fails", async () => {
    fetchMock
      .mockResolvedValueOnce({
        json: async () => ({ items: [{ id: "groups-record" }] }),
        ok: true,
      })
      .mockResolvedValueOnce({
        json: async () => ({ message: "Something went wrong." }),
        ok: false,
        status: 500,
      });

    await expect(syncTabGroupsToServer()).rejects.toThrow(
      "Syncing tab groups failed (500). Something went wrong.",
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://pocketbase.test/api/collections/browser_groups/records/groups-record",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("rejects when creating the first tab group snapshot fails", async () => {
    fetchMock
      .mockResolvedValueOnce({ json: async () => ({ items: [] }), ok: true })
      .mockResolvedValueOnce({
        json: async () => ({ message: "The request was rejected." }),
        ok: false,
        status: 403,
      });

    await expect(syncTabGroupsToServer()).rejects.toThrow(
      "Syncing tab groups failed (403). The request was rejected.",
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://pocketbase.test/api/collections/browser_groups/records",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
