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

  it("matches tab-group destinations without case sensitivity and otherwise falls back", () => {
    const tab = sharedTab("one", "Research");
    const groups = [{ id: 9, title: " research ", windowId: 12 }] as chrome.tabGroups.TabGroup[];

    expect(resolveTabDestination(tab, 3, groups)).toEqual({ groupId: 9, windowId: 12 });
    expect(resolveTabDestination({ ...tab, destination: "Missing" }, 3, groups)).toEqual({
      groupId: null,
      windowId: 3,
    });
  });

  it("formats invalid and same-day history times", () => {
    const now = new Date("2026-07-20T15:00:00.000Z");
    expect(formatBatchTime("not-a-date", now)).toBe("Unknown time");
    expect(formatBatchTime("2026-07-20T12:00:00.000Z", now)).toMatch(TODAY_PREFIX);
  });
});

function sharedTab(id: string, destination: string | null): DeviceTab {
  return normalizeSharedLink({
    ...(destination ? { destination } : {}),
    id,
    source: "iPhone",
    title: `Link ${id}`,
    url: `https://${id}.test`,
  });
}
