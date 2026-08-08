import { beforeEach, describe, expect, it, vi } from "vitest";
import { markSharedLinksOpened } from "../src/popup/shared-links";
import { recordOpenedBatch } from "../src/popup/storage";
import {
  OpenedTabsCleanupError,
  OpenedTabsSyncError,
  openTabsInBrowser,
} from "../src/popup/tab-opener";
import type { DeviceTab } from "../src/popup/types";

vi.mock("../src/popup/shared-links", () => ({ markSharedLinksOpened: vi.fn() }));
vi.mock("../src/popup/storage", () => ({ recordOpenedBatch: vi.fn() }));

describe("openTabsInBrowser", () => {
  const create = vi.fn();
  const group = vi.fn();
  const updateTab = vi.fn();
  const updateWindow = vi.fn();
  const updateGroup = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    create.mockResolvedValueOnce({ id: 11 }).mockResolvedValueOnce({ id: 12 });
    vi.stubGlobal("chrome", {
      runtime: { lastError: undefined },
      tabGroups: {
        query: vi.fn(async () => [{ id: 7, title: "Research", windowId: 2 }]),
        update: updateGroup,
      },
      tabs: { create, group, update: updateTab },
      windows: {
        getAll: vi.fn(async () => [{ id: 1 }, { id: 2 }]),
        getCurrent: vi.fn((_options, callback) => callback({ id: 1 })),
        update: updateWindow,
      },
    });
  });

  it("syncs the group snapshot before link and history bookkeeping", async () => {
    const tabs = [tab("shared:one", "Research"), tab("sync:two", null)];
    const syncTabGroups = vi.fn(async () => undefined);

    await openTabsInBrowser(tabs, syncTabGroups);

    expect(create).toHaveBeenNthCalledWith(1, {
      active: false,
      url: "https://shared-one.test",
      windowId: 2,
    });
    expect(create).toHaveBeenNthCalledWith(2, {
      active: false,
      url: "https://sync-two.test",
      windowId: 1,
    });
    expect(group).toHaveBeenCalledWith({ groupId: 7, tabIds: [11] });
    // The grouped tab appends silently; only the ungrouped tab (already in
    // the current window) is activated.
    expect(updateWindow).not.toHaveBeenCalled();
    expect(updateTab).toHaveBeenCalledWith(12, { active: true });
    expect(markSharedLinksOpened).toHaveBeenCalledWith(tabs);
    expect(recordOpenedBatch).toHaveBeenCalledWith(tabs);

    const lastCreateOrder = create.mock.invocationCallOrder.at(-1) ?? 0;
    const syncOrder = syncTabGroups.mock.invocationCallOrder[0] ?? 0;
    const markOrder = vi.mocked(markSharedLinksOpened).mock.invocationCallOrder[0] ?? 0;
    const recordOrder = vi.mocked(recordOpenedBatch).mock.invocationCallOrder[0] ?? 0;
    expect(lastCreateOrder).toBeLessThan(syncOrder);
    expect(syncOrder).toBeLessThan(markOrder);
    expect(markOrder).toBeLessThan(recordOrder);
  });

  it("marks links and records history before surfacing a snapshot sync failure", async () => {
    const tabs = [tab("shared:one", "Research")];
    const syncTabGroups = vi.fn().mockRejectedValueOnce(new Error("Sync failed"));

    await expect(openTabsInBrowser(tabs, syncTabGroups)).rejects.toBeInstanceOf(
      OpenedTabsSyncError,
    );

    expect(markSharedLinksOpened).toHaveBeenCalledWith(tabs);
    expect(recordOpenedBatch).toHaveBeenCalledWith(tabs);
  });

  it("skips snapshot sync when no hook is provided", async () => {
    const tabs = [tab("shared:one", "Research")];

    await openTabsInBrowser(tabs, null);

    expect(markSharedLinksOpened).toHaveBeenCalledWith(tabs);
    expect(recordOpenedBatch).toHaveBeenCalledWith(tabs);
  });

  it("surfaces link cleanup failure when snapshot sync also fails", async () => {
    vi.mocked(markSharedLinksOpened).mockRejectedValueOnce(new Error("PATCH failed"));
    const syncTabGroups = vi.fn().mockRejectedValueOnce(new Error("Sync failed"));

    const result = openTabsInBrowser([tab("shared:one", "Research")], syncTabGroups);
    const error = await result.catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(OpenedTabsCleanupError);
    expect(error).toMatchObject({
      message: "The tabs opened, but their shared links could not be cleared. PATCH failed",
      name: "OpenedTabsCleanupError",
    });

    expect(recordOpenedBatch).not.toHaveBeenCalled();
    // The batch was all grouped tabs, so nothing is activated even on the
    // cleanup-failure path.
    expect(updateTab).not.toHaveBeenCalled();
  });

  it("creates a new tab group for a destination with no live match, and titles it", async () => {
    create.mockReset();
    create.mockResolvedValueOnce({ id: 21 });
    group.mockResolvedValueOnce(55);

    await openTabsInBrowser([tab("shared:one", "Reading List")], null);

    expect(group).toHaveBeenCalledWith({ createProperties: { windowId: 1 }, tabIds: [21] });
    expect(updateGroup).toHaveBeenCalledWith(55, { title: "Reading List" });
  });

  it("adds tabs sharing the same unmatched destination into one newly-created group", async () => {
    create.mockReset();
    create.mockResolvedValueOnce({ id: 21 }).mockResolvedValueOnce({ id: 22 });
    group.mockResolvedValueOnce(55);

    await openTabsInBrowser(
      [tab("shared:one", "Reading List"), tab("shared:two", "Reading List")],
      null,
    );

    expect(group).toHaveBeenNthCalledWith(1, {
      createProperties: { windowId: 1 },
      tabIds: [21],
    });
    expect(group).toHaveBeenNthCalledWith(2, { groupId: 55, tabIds: [22] });
    expect(updateGroup).toHaveBeenCalledTimes(1);
    expect(updateGroup).toHaveBeenCalledWith(55, { title: "Reading List" });
  });

  it("creates a targeted new group in its destination window, separate from an identically titled one", async () => {
    create.mockReset();
    create.mockResolvedValueOnce({ id: 21 }).mockResolvedValueOnce({ id: 22 });
    group.mockResolvedValueOnce(55).mockResolvedValueOnce(56);

    await openTabsInBrowser(
      [tab("shared:one", "Reading List", 2), tab("shared:two", "Reading List")],
      null,
    );

    expect(create).toHaveBeenNthCalledWith(1, {
      active: false,
      url: "https://shared-one.test",
      windowId: 2,
    });
    expect(create).toHaveBeenNthCalledWith(2, {
      active: false,
      url: "https://shared-two.test",
      windowId: 1,
    });
    expect(group).toHaveBeenNthCalledWith(1, {
      createProperties: { windowId: 2 },
      tabIds: [21],
    });
    expect(group).toHaveBeenNthCalledWith(2, {
      createProperties: { windowId: 1 },
      tabIds: [22],
    });
    expect(updateGroup).toHaveBeenNthCalledWith(1, 55, { title: "Reading List" });
    expect(updateGroup).toHaveBeenNthCalledWith(2, 56, { title: "Reading List" });
  });

  it("creates a new group in a non-current destination window", async () => {
    create.mockReset();
    create.mockResolvedValueOnce({ id: 21 });
    group.mockResolvedValueOnce(55);

    await openTabsInBrowser([tab("shared:one", "Reading List", 2)], null);

    expect(group).toHaveBeenCalledWith({
      createProperties: { windowId: 2 },
      tabIds: [21],
    });
    expect(updateGroup).toHaveBeenCalledWith(55, { title: "Reading List" });
  });

  it("opens grouped tabs silently, without focusing a window or activating a tab", async () => {
    create.mockReset();
    create.mockResolvedValueOnce({ id: 21 }).mockResolvedValueOnce({ id: 22 });

    await openTabsInBrowser([tab("shared:one", "Research"), tab("shared:two", "Research")], null);

    expect(group).toHaveBeenCalledTimes(2);
    expect(updateWindow).not.toHaveBeenCalled();
    expect(updateTab).not.toHaveBeenCalled();
  });

  it("leaves tabs without a destination ungrouped", async () => {
    create.mockReset();
    create.mockResolvedValueOnce({ id: 21 });

    await openTabsInBrowser([tab("sync:one", null)], null);

    expect(group).not.toHaveBeenCalled();
    expect(updateGroup).not.toHaveBeenCalled();
  });
});

function tab(id: string, destination: string | null, destinationWindowId?: number): DeviceTab {
  return {
    destination,
    ...(destinationWindowId === undefined ? {} : { destinationWindowId }),
    id,
    searchable: id,
    source: "Phone",
    title: id,
    url: `https://${id.replace(":", "-")}.test`,
  };
}
