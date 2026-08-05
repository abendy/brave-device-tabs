import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BROWSER_GROUPS_RECORD_ID,
  markSharedLinksOpened,
  syncTabGroupsToServer,
} from "../src/popup/shared-links";

describe("markSharedLinksOpened", () => {
  const fetchMock = vi.fn();
  const tabGroupsQueryMock = vi.fn<() => Promise<chrome.tabGroups.TabGroup[]>>(async () => []);
  const tabsQueryMock = vi.fn<() => Promise<chrome.tabs.Tab[]>>(async () => []);

  beforeEach(() => {
    tabGroupsQueryMock.mockReset();
    tabGroupsQueryMock.mockResolvedValue([]);
    tabsQueryMock.mockReset();
    tabsQueryMock.mockResolvedValue([]);
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
        ok: true,
      })
      .mockResolvedValueOnce({ ok: true });

    await syncTabGroupsToServer();

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `https://pocketbase.test/api/collections/browser_groups/records/${BROWSER_GROUPS_RECORD_ID}`,
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

  it("serializes overlapping syncs and writes each fresh browser snapshot in order", async () => {
    tabGroupsQueryMock
      .mockResolvedValueOnce([
        { collapsed: false, color: "blue", id: 1, shared: false, title: "Existing", windowId: 1 },
      ])
      .mockResolvedValueOnce([
        { collapsed: false, color: "blue", id: 1, shared: false, title: "Existing", windowId: 1 },
        { collapsed: false, color: "green", id: 2, shared: false, title: "New Group", windowId: 2 },
      ]);
    tabsQueryMock
      .mockResolvedValueOnce([{ groupId: 1, index: 0 } as chrome.tabs.Tab])
      .mockResolvedValueOnce([
        { groupId: 1, index: 0 } as chrome.tabs.Tab,
        { groupId: 2, index: 3 } as chrome.tabs.Tab,
      ]);

    let finishFirstWrite!: () => void;
    const firstWrite = new Promise<{ ok: boolean }>((resolve) => {
      finishFirstWrite = () => resolve({ ok: true });
    });
    fetchMock
      .mockResolvedValueOnce({ ok: true })
      .mockReturnValueOnce(firstWrite)
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true });

    const firstSync = syncTabGroupsToServer();
    const secondSync = syncTabGroupsToServer();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(tabGroupsQueryMock).toHaveBeenCalledOnce();
    expect(tabsQueryMock).toHaveBeenCalledOnce();

    finishFirstWrite();
    await Promise.all([firstSync, secondSync]);

    expect(tabGroupsQueryMock).toHaveBeenCalledTimes(2);
    expect(tabsQueryMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `https://pocketbase.test/api/collections/browser_groups/records/${BROWSER_GROUPS_RECORD_ID}`,
      expect.objectContaining({
        body: JSON.stringify({
          groups: [{ color: "blue", index: 0, title: "Existing", windowId: 1 }],
        }),
        method: "PATCH",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      `https://pocketbase.test/api/collections/browser_groups/records/${BROWSER_GROUPS_RECORD_ID}`,
      expect.objectContaining({
        body: JSON.stringify({
          groups: [
            { color: "blue", index: 0, title: "Existing", windowId: 1 },
            { color: "green", index: 3, title: "New Group", windowId: 2 },
          ],
        }),
        method: "PATCH",
      }),
    );
  });

  it("continues with a fresh sync after an earlier queued sync rejects", async () => {
    tabGroupsQueryMock
      .mockResolvedValueOnce([
        { collapsed: false, color: "blue", id: 1, shared: false, title: "Stale", windowId: 1 },
      ])
      .mockResolvedValueOnce([
        { collapsed: false, color: "green", id: 2, shared: false, title: "Fresh", windowId: 2 },
      ]);
    tabsQueryMock
      .mockResolvedValueOnce([{ groupId: 1, index: 0 } as chrome.tabs.Tab])
      .mockResolvedValueOnce([{ groupId: 2, index: 4 } as chrome.tabs.Tab]);
    fetchMock
      .mockResolvedValueOnce({
        json: async () => ({ message: "Temporary failure." }),
        ok: false,
        status: 500,
      })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true });

    await expect(syncTabGroupsToServer()).rejects.toThrow(
      "Loading tab groups failed (500). Temporary failure.",
    );
    await expect(syncTabGroupsToServer()).resolves.toBeUndefined();

    expect(tabGroupsQueryMock).toHaveBeenCalledTimes(2);
    expect(tabsQueryMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      `https://pocketbase.test/api/collections/browser_groups/records/${BROWSER_GROUPS_RECORD_ID}`,
      expect.objectContaining({
        body: JSON.stringify({
          groups: [{ color: "green", index: 4, title: "Fresh", windowId: 2 }],
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
    fetchMock.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({
      json: async () => ({ message: "Something went wrong." }),
      ok: false,
      status: 500,
    });

    await expect(syncTabGroupsToServer()).rejects.toThrow(
      "Syncing tab groups failed (500). Something went wrong.",
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `https://pocketbase.test/api/collections/browser_groups/records/${BROWSER_GROUPS_RECORD_ID}`,
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("re-gets and patches after a concurrent fixed-id creator wins", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({
        json: async () => ({ data: { id: { code: "validation_not_unique" } } }),
        ok: false,
        status: 400,
      })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true });

    await expect(syncTabGroupsToServer()).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://pocketbase.test/api/collections/browser_groups/records",
      expect.objectContaining({
        body: JSON.stringify({ groups: [], id: BROWSER_GROUPS_RECORD_ID }),
        method: "POST",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      `https://pocketbase.test/api/collections/browser_groups/records/${BROWSER_GROUPS_RECORD_ID}`,
      expect.objectContaining({ headers: { Authorization: "token" } }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      `https://pocketbase.test/api/collections/browser_groups/records/${BROWSER_GROUPS_RECORD_ID}`,
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("rejects when creating the first tab group snapshot fails", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 }).mockResolvedValueOnce({
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
      expect.objectContaining({
        body: JSON.stringify({ groups: [], id: BROWSER_GROUPS_RECORD_ID }),
        method: "POST",
      }),
    );
  });
});
