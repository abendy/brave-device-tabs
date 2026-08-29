import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BROWSER_GROUPS_RECORD_ID,
  loadSharedLinksDevices,
  mapStaleWindows,
  markSharedLinksOpened,
  syncTabGroupsToServer,
} from "../src/popup/shared-links";

describe("loadSharedLinksDevices", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("concatenates two pages while preserving the shared-link query", async () => {
    fetchMock
      .mockResolvedValueOnce({
        json: async () => ({
          items: [
            {
              destination: "Research",
              id: "first",
              source: "Phone",
              title: "First link",
              url: "https://example.test/first",
            },
          ],
          page: 1,
          perPage: 200,
          totalItems: 2,
          totalPages: 2,
        }),
        ok: true,
      })
      .mockResolvedValueOnce({
        json: async () => ({
          items: [
            {
              destination: "Research",
              id: "second",
              source: "Phone",
              title: "Second link",
              url: "https://example.test/second",
            },
          ],
          page: 2,
          perPage: 200,
          totalItems: 2,
          totalPages: 2,
        }),
        ok: true,
      });

    const devices = await loadSharedLinksDevices();

    expect(devices).toHaveLength(1);
    expect(devices[0]?.tabs.map((tab) => tab.id)).toEqual(["shared:first", "shared:second"]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://pocketbase.test/api/collections/shared_links/records?filter=(opened%3Dfalse)&sort=-created&perPage=200&page=1",
      { headers: { Authorization: "token" } },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://pocketbase.test/api/collections/shared_links/records?filter=(opened%3Dfalse)&sort=-created&perPage=200&page=2",
      { headers: { Authorization: "token" } },
    );
  });

  it("does not request another page when the response is single-page", async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({
        items: [],
        page: 1,
        perPage: 200,
        totalItems: 0,
        totalPages: 1,
      }),
      ok: true,
    });

    await expect(loadSharedLinksDevices()).resolves.toEqual([]);

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("warns and stops after the pagination safety cap", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fetchMock.mockResolvedValue({
      json: async () => ({
        items: [],
        page: 1,
        perPage: 200,
        totalItems: 4_200,
        totalPages: 21,
      }),
      ok: true,
    });

    await expect(loadSharedLinksDevices()).resolves.toEqual([]);

    expect(fetchMock).toHaveBeenCalledTimes(20);
    expect(warnSpy).toHaveBeenCalledWith("Shared Links pagination stopped after 20 pages.");
  });
});

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
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({
        json: async () => ({ message: "The request was rejected." }),
        ok: false,
        status: 403,
      })
      .mockResolvedValueOnce({ ok: false, status: 404 });

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
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      `https://pocketbase.test/api/collections/browser_groups/records/${BROWSER_GROUPS_RECORD_ID}`,
      expect.objectContaining({ headers: { Authorization: "token" } }),
    );
  });

  it("retargets pinned groups and links from a vanished window to its fingerprint match", async () => {
    tabGroupsQueryMock.mockResolvedValueOnce([
      { collapsed: false, color: "blue", id: 1, shared: false, title: "Research", windowId: 101 },
    ]);
    tabsQueryMock.mockResolvedValueOnce([{ groupId: 1, index: 0 } as chrome.tabs.Tab]);

    fetchMock
      .mockResolvedValueOnce({
        json: async () => ({
          groups: [{ color: "blue", index: 0, title: "Research", windowId: 42 }],
        }),
        ok: true,
      })
      .mockResolvedValueOnce({ json: async () => ({ items: [{ id: "pin1" }] }), ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ json: async () => ({ items: [{ id: "link1" }] }), ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true });

    await syncTabGroupsToServer();

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `https://pocketbase.test/api/collections/pinned_groups/records?filter=${encodeURIComponent("(windowId=42)")}&fields=id&perPage=200`,
      expect.objectContaining({ headers: { Authorization: "token" } }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://pocketbase.test/api/collections/pinned_groups/records/pin1",
      expect.objectContaining({ body: JSON.stringify({ windowId: 101 }), method: "PATCH" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      `https://pocketbase.test/api/collections/shared_links/records?filter=${encodeURIComponent("(opened=false && destinationWindowId=42)")}&fields=id&perPage=200`,
      expect.objectContaining({ headers: { Authorization: "token" } }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      "https://pocketbase.test/api/collections/shared_links/records/link1",
      expect.objectContaining({
        body: JSON.stringify({ destinationWindowId: 101 }),
        method: "PATCH",
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});

describe("mapStaleWindows", () => {
  it("maps a vanished window to the live window sharing its group titles", () => {
    const mapping = mapStaleWindows(
      [
        { title: "Research", windowId: 42 },
        { title: "Dump", windowId: 42 },
      ],
      [
        { title: " research ", windowId: 101 },
        { title: "Dump", windowId: 101 },
      ],
    );

    expect(mapping).toEqual(new Map([[42, 101]]));
  });

  it("matches through the smaller fingerprint when a window gained groups", () => {
    const mapping = mapStaleWindows(
      [{ title: "Dump", windowId: 42 }],
      [
        { title: "Dump", windowId: 101 },
        { title: "Fresh", windowId: 101 },
        { title: "Later", windowId: 101 },
      ],
    );

    expect(mapping).toEqual(new Map([[42, 101]]));
  });

  it("gives a live window to the vanished window with the most shared titles", () => {
    const mapping = mapStaleWindows(
      [
        { title: "Alpha", windowId: 42 },
        { title: "Beta", windowId: 42 },
        { title: "Alpha", windowId: 43 },
      ],
      [
        { title: "Alpha", windowId: 101 },
        { title: "Beta", windowId: 101 },
      ],
    );

    expect(mapping).toEqual(new Map([[42, 101]]));
  });

  it("maps nothing below the half-overlap threshold or for surviving ids", () => {
    expect(
      mapStaleWindows(
        [
          { title: "Alpha", windowId: 42 },
          { title: "Beta", windowId: 42 },
          { title: "Gamma", windowId: 42 },
          { title: "Delta", windowId: 42 },
        ],
        [
          { title: "Alpha", windowId: 101 },
          { title: "Other", windowId: 101 },
          { title: "More", windowId: 101 },
          { title: "Stuff", windowId: 101 },
        ],
      ),
    ).toEqual(new Map());
    expect(
      mapStaleWindows([{ title: "Planning", windowId: 7 }], [{ title: "Other", windowId: 7 }]),
    ).toEqual(new Map());
  });
});
