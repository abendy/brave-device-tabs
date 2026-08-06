import { describe, expect, it } from "vitest";
import {
  formatBatchTime,
  groupSharedLinksByDestination,
  normalizeDevices,
  normalizeSharedLink,
  resolveTabDestination,
} from "../src/popup/domain";
import type { DeviceTab } from "../src/popup/types";

const TODAY_PREFIX = /^Today at /;

describe("popup domain", () => {
  it("normalizes synced tabs in device order and removes duplicate or internal URLs", () => {
    const rawDevices = [
      {
        deviceName: "Phone",
        sessions: [
          {
            window: {
              tabs: [
                { sessionId: "older", title: "Older title", url: "https://example.com/a" },
                { sessionId: "newer", title: "Newer title", url: "https://example.com/a" },
                { sessionId: "internal", title: "Settings", url: "brave://settings" },
              ],
            },
          },
        ],
      },
    ] as unknown as chrome.sessions.Device[];

    const devices = normalizeDevices(rawDevices);

    expect(devices).toHaveLength(1);
    expect(devices[0]?.tabs).toHaveLength(1);
    expect(devices[0]?.tabs[0]?.title).toBe("Newer title");
    expect(devices[0]?.tabs[0]?.source).toBe("Phone");
  });

  it("groups shared links with undirected links first and destinations alphabetically", () => {
    const tabs = [sharedTab("one", "Zulu"), sharedTab("two", null), sharedTab("three", "Alpha")];

    expect(groupSharedLinksByDestination(tabs).map((device) => device.name)).toEqual([
      "Shared Links",
      "Alpha",
      "Zulu",
    ]);
  });

  it("splits same-titled destinations by window and ranks windows ascending", () => {
    const devices = groupSharedLinksByDestination([
      sharedTab("late", "Research", 30),
      sharedTab("early", "Research", 12),
    ]);

    expect(
      devices.map((device) => ({
        id: device.id,
        name: device.name,
        tabIds: device.tabs.map((tab) => tab.id),
      })),
    ).toEqual([
      {
        id: "shared-links:research:w12",
        name: "Research · Window 1",
        tabIds: ["shared:early"],
      },
      {
        id: "shared-links:research:w30",
        name: "Research · Window 2",
        tabIds: ["shared:late"],
      },
    ]);
  });

  it("puts a windowless bucket before its windowed collision", () => {
    const devices = groupSharedLinksByDestination([
      sharedTab("windowed", "Research", 12),
      sharedTab("windowless", "Research"),
    ]);

    expect(
      devices.map((device) => ({
        id: device.id,
        name: device.name,
        tabIds: device.tabs.map((tab) => tab.id),
      })),
    ).toEqual([
      {
        id: "shared-links:research",
        name: "Research",
        tabIds: ["shared:windowless"],
      },
      {
        id: "shared-links:research:w12",
        name: "Research · Window 1",
        tabIds: ["shared:windowed"],
      },
    ]);
  });

  it("does not suffix a unique title with its window", () => {
    const devices = groupSharedLinksByDestination([sharedTab("one", "Research", 12)]);

    expect(devices).toEqual([
      expect.objectContaining({
        id: "shared-links:research:w12",
        name: "Research",
      }),
    ]);
  });

  it("merges case-variant titles in the same window using the first casing", () => {
    const devices = groupSharedLinksByDestination([
      sharedTab("first", "Research", 12),
      sharedTab("second", "research", 12),
    ]);

    expect(devices).toEqual([
      expect.objectContaining({
        id: "shared-links:research:w12",
        name: "Research",
        tabs: expect.arrayContaining([
          expect.objectContaining({ id: "shared:first" }),
          expect.objectContaining({ id: "shared:second" }),
        ]),
      }),
    ]);
  });

  it("matches tab-group destinations without case sensitivity and otherwise falls back", () => {
    const tab = sharedTab("one", "Research");
    const groups = [{ id: 9, title: " research ", windowId: 12 }] as chrome.tabGroups.TabGroup[];

    expect(resolveTabDestination(tab, 3, groups, new Set([3, 12]))).toEqual({
      groupId: 9,
      newGroupTitle: null,
      windowId: 12,
    });
    expect(
      resolveTabDestination({ ...tab, destination: "Missing" }, 3, groups, new Set([3, 12])),
    ).toEqual({
      groupId: null,
      newGroupTitle: "Missing",
      windowId: 3,
    });
  });

  it("reports no new group needed when a tab has no destination", () => {
    const tab = sharedTab("one", null);

    expect(resolveTabDestination(tab, 3, [], new Set([3]))).toEqual({
      groupId: null,
      newGroupTitle: null,
      windowId: 3,
    });
  });

  it("prefers the destination window's copy of a duplicated group title", () => {
    const tab = sharedTab("one", "Research", 30);
    const groups = [
      { id: 9, title: "Research", windowId: 12 },
      { id: 10, title: "Research", windowId: 30 },
    ] as chrome.tabGroups.TabGroup[];

    expect(resolveTabDestination(tab, 3, groups, new Set([3, 12, 30]))).toEqual({
      groupId: 10,
      newGroupTitle: null,
      windowId: 30,
    });
  });

  it("creates a new group in the targeted window when it has no matching group", () => {
    const tab = sharedTab("one", "Fresh", 30);

    expect(resolveTabDestination(tab, 3, [], new Set([3, 30]))).toEqual({
      groupId: null,
      newGroupTitle: "Fresh",
      windowId: 30,
    });
  });

  it("falls back to title-only routing when the targeted window is gone", () => {
    const groups = [{ id: 9, title: "Research", windowId: 12 }] as chrome.tabGroups.TabGroup[];

    expect(
      resolveTabDestination(sharedTab("one", "Research", 99), 3, groups, new Set([3, 12])),
    ).toEqual({
      groupId: 9,
      newGroupTitle: null,
      windowId: 12,
    });
    expect(
      resolveTabDestination(sharedTab("two", "Fresh", 99), 3, groups, new Set([3, 12])),
    ).toEqual({
      groupId: null,
      newGroupTitle: "Fresh",
      windowId: 3,
    });
  });

  it("keeps a stored destination window id only when it is a positive number", () => {
    expect(sharedTab("one", "Research", 7).destinationWindowId).toBe(7);
    expect(sharedTab("two", "Research", 0).destinationWindowId).toBeUndefined();
    expect(sharedTab("three", "Research").destinationWindowId).toBeUndefined();
  });

  it("formats invalid and same-day history times", () => {
    const now = new Date("2026-07-20T15:00:00.000Z");
    expect(formatBatchTime("not-a-date", now)).toBe("Unknown time");
    expect(formatBatchTime("2026-07-20T12:00:00.000Z", now)).toMatch(TODAY_PREFIX);
  });
});

function sharedTab(id: string, destination: string | null, windowId?: number): DeviceTab {
  return normalizeSharedLink({
    ...(destination ? { destination } : {}),
    ...(windowId === undefined ? {} : { destinationWindowId: windowId }),
    id,
    source: "iPhone",
    title: `Link ${id}`,
    url: `https://${id}.test`,
  });
}
