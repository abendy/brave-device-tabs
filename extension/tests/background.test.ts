import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshSession } from "../src/popup/auth";
import { syncTabGroupsToServer } from "../src/popup/shared-links";

const mocks = vi.hoisted(() => ({
  refreshSession: vi.fn(),
  syncTabGroupsToServer: vi.fn(),
}));

vi.mock("../src/popup/auth", () => ({ refreshSession: mocks.refreshSession }));
vi.mock("../src/popup/shared-links", () => ({
  syncTabGroupsToServer: mocks.syncTabGroupsToServer,
}));

describe("background tab-group sync", () => {
  const createEvent = () => ({ addListener: vi.fn() });
  let background: typeof import("../src/background/main");

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.stubGlobal("chrome", {
      runtime: {
        onInstalled: createEvent(),
        onStartup: createEvent(),
      },
      tabGroups: {
        onCreated: createEvent(),
        onMoved: createEvent(),
        onRemoved: createEvent(),
        onUpdated: createEvent(),
      },
      tabs: {
        onAttached: createEvent(),
        onDetached: createEvent(),
        onMoved: createEvent(),
      },
    });
    vi.resetModules();
    background = await import("../src/background/main");
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("coalesces bursts and schedules a later event separately", async () => {
    vi.mocked(refreshSession).mockResolvedValue("valid");
    vi.mocked(syncTabGroupsToServer).mockResolvedValue(undefined);

    background.scheduleTabGroupSync();
    background.scheduleTabGroupSync();
    background.scheduleTabGroupSync();

    await vi.advanceTimersByTimeAsync(background.TAB_GROUP_SYNC_DEBOUNCE_MS - 1);
    expect(syncTabGroupsToServer).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(syncTabGroupsToServer).toHaveBeenCalledOnce();

    background.scheduleTabGroupSync();
    await vi.advanceTimersByTimeAsync(background.TAB_GROUP_SYNC_DEBOUNCE_MS);
    expect(syncTabGroupsToServer).toHaveBeenCalledTimes(2);
  });

  it.each([
    "expired",
    "notConfigured",
  ] as const)("skips a %s session without syncing or warning", async (session) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.mocked(refreshSession).mockResolvedValue(session);

    await background.runBackgroundSync();

    expect(syncTabGroupsToServer).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns and skips when session refresh is unreachable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.mocked(refreshSession).mockResolvedValue("unreachable");

    await background.runBackgroundSync();

    expect(syncTabGroupsToServer).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "Unable to refresh the session for background tab-group sync.",
    );
  });

  it("syncs after a valid session refresh", async () => {
    vi.mocked(refreshSession).mockResolvedValue("valid");
    vi.mocked(syncTabGroupsToServer).mockResolvedValue(undefined);

    await background.runBackgroundSync();

    expect(refreshSession).toHaveBeenCalledOnce();
    expect(syncTabGroupsToServer).toHaveBeenCalledOnce();
  });
});
