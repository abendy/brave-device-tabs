import { beforeEach, describe, expect, it, vi } from "vitest";
import { markSharedLinksOpened } from "../src/popup/shared-links";
import { recordOpenedBatch } from "../src/popup/storage";
import { openTabsInBrowser } from "../src/popup/tab-opener";
import type { DeviceTab } from "../src/popup/types";

vi.mock("../src/popup/shared-links", () => ({ markSharedLinksOpened: vi.fn() }));
vi.mock("../src/popup/storage", () => ({ recordOpenedBatch: vi.fn() }));

describe("openTabsInBrowser", () => {
  const create = vi.fn();
  const group = vi.fn();
  const updateTab = vi.fn();
  const updateWindow = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    create.mockResolvedValueOnce({ id: 11 }).mockResolvedValueOnce({ id: 12 });
    vi.stubGlobal("chrome", {
      runtime: { lastError: undefined },
      tabGroups: {
        query: vi.fn(async () => [{ id: 7, title: "Research", windowId: 2 }]),
      },
      tabs: { create, group, update: updateTab },
      windows: {
        getCurrent: vi.fn((_options, callback) => callback({ id: 1 })),
        update: updateWindow,
      },
    });
  });

  it("opens the whole batch before bookkeeping and activates its first tab last", async () => {
    const tabs = [tab("shared:one", "Research"), tab("sync:two", null)];

    await openTabsInBrowser(tabs);

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
    expect(updateWindow).toHaveBeenCalledWith(2, { focused: true });
    expect(updateTab).toHaveBeenCalledWith(11, { active: true });
    expect(markSharedLinksOpened).toHaveBeenCalledWith(tabs);
    expect(recordOpenedBatch).toHaveBeenCalledWith(tabs);

    const activationOrder = updateTab.mock.invocationCallOrder[0] ?? 0;
    expect(vi.mocked(recordOpenedBatch).mock.invocationCallOrder[0]).toBeLessThan(activationOrder);
  });
});

function tab(id: string, destination: string | null): DeviceTab {
  return {
    destination,
    id,
    searchable: id,
    source: "Phone",
    title: id,
    url: `https://${id.replace(":", "-")}.test`,
  };
}
