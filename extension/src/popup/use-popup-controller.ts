import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getOpenedIdSet, getVisibleDevices } from "./domain";
import type { PopupServices } from "./popup-services";
import { OpenedTabsCleanupError } from "./tab-opener";
import type {
  ActiveView,
  Device,
  DeviceTab,
  OpenedBatch,
  OpeningMode,
  StatusMessage,
  VisibleDevice,
} from "./types";

interface PopupController {
  activeView: ActiveView;
  allVisibleSelected: boolean;
  deleteTab(tabId: string): Promise<void>;
  filter: string;
  history: OpenedBatch[];
  loading: boolean;
  openAll(): Promise<void>;
  openSelected(): Promise<void>;
  openingMode: OpeningMode;
  refresh(): Promise<void>;
  openedTabIds: ReadonlySet<string>;
  selected: ReadonlySet<string>;
  selectedCount: number;
  setActiveView(view: ActiveView): void;
  setFilter(value: string): void;
  status: StatusMessage | null;
  toggleDevice(deviceId: string, checked: boolean): void;
  toggleTab(tabId: string, checked: boolean): void;
  toggleVisibleSelection(): void;
  totalTabs: number;
  viewDevices: Device[];
  visibleDevices: VisibleDevice[];
  visibleTabIds: string[];
}

export function usePopupController(
  services: PopupServices,
  closePopup: () => void,
): PopupController {
  const [activeView, setActiveView] = useState<ActiveView>("links");
  const [linkDevices, setLinkDevices] = useState<Device[]>([]);
  const [deviceDevices, setDeviceDevices] = useState<Device[]>([]);
  const [filter, setFilterValue] = useState("");
  const [history, setHistory] = useState<OpenedBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [openingMode, setOpeningMode] = useState<OpeningMode>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const refreshing = useRef(false);
  const normalizedFilter = useMemo(() => filter.trim().toLocaleLowerCase(), [filter]);
  const openedTabIds = useMemo(() => getOpenedIdSet(history), [history]);

  const viewDevices = activeView === "devices" ? deviceDevices : linkDevices;
  const totalTabs = viewDevices.reduce((sum, device) => sum + device.tabs.length, 0);

  const visibleDevices = useMemo(
    () => getVisibleDevices(viewDevices, normalizedFilter),
    [viewDevices, normalizedFilter],
  );
  const visibleTabIds = useMemo(
    () => visibleDevices.flatMap((entry) => entry.tabs.map((tab) => tab.id)),
    [visibleDevices],
  );
  const allVisibleSelected =
    visibleTabIds.length > 0 && visibleTabIds.every((id) => selected.has(id));
  const selectedCount = viewDevices
    .flatMap((device) => device.tabs)
    .filter((tab) => selected.has(tab.id)).length;

  const refresh = useCallback(async () => {
    if (refreshing.current) {
      return;
    }
    refreshing.current = true;
    setLoading(true);
    setStatus(null);

    try {
      const [syncedResult, sharedDevices, openedHistory] = await Promise.all([
        services.loadSyncedDevices(),
        services.loadSharedLinksDevices(),
        services.loadOpenedHistory(),
      ]);
      const nextLinkDevices = sharedDevices;
      const nextDeviceDevices = syncedResult.devices;

      setHistory(openedHistory);
      setLinkDevices(nextLinkDevices);
      setDeviceDevices(nextDeviceDevices);
      setSelected((current) =>
        removeStaleSelections(current, [...nextLinkDevices, ...nextDeviceDevices]),
      );
      if (syncedResult.error) {
        setStatus({ kind: "error", text: syncedResult.error });
      }
      void services.syncTabGroupsToServer();
    } catch (error) {
      console.error("Unable to refresh tabs:", error);
      setStatus({ kind: "error", text: "Could not refresh tabs. Try again." });
    } finally {
      refreshing.current = false;
      setLoading(false);
    }
  }, [services]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setFilter = useCallback((value: string) => {
    setFilterValue(value);
  }, []);

  const toggleTab = useCallback((tabId: string, checked: boolean) => {
    setSelected((current) => updateSelection(current, [tabId], checked));
  }, []);

  const toggleDevice = useCallback(
    (deviceId: string, checked: boolean) => {
      const entry = visibleDevices.find(({ device }) => device.id === deviceId);
      if (entry) {
        setSelected((current) =>
          updateSelection(
            current,
            entry.tabs.map((tab) => tab.id),
            checked,
          ),
        );
      }
    },
    [visibleDevices],
  );

  const toggleVisibleSelection = useCallback(() => {
    setSelected((current) => {
      const shouldSelect = !visibleTabIds.every((id) => current.has(id));
      return updateSelection(current, visibleTabIds, shouldSelect);
    });
  }, [visibleTabIds]);

  const deleteTab = useCallback(
    async (tabId: string) => {
      setStatus(null);
      try {
        if (await services.deleteSharedLink(tabId)) {
          setLinkDevices((current) => removeTab(current, tabId));
          setSelected((current) => updateSelection(current, [tabId], false));
        }
      } catch (error) {
        console.error("Unable to delete shared link:", error);
        setStatus({ kind: "error", text: "Could not discard that link. Try again." });
      }
    },
    [services],
  );

  const runOpen = useCallback(
    async (tabs: DeviceTab[], mode: Exclude<OpeningMode, null>) => {
      if (tabs.length === 0) {
        return;
      }
      setOpeningMode(mode);
      setStatus(null);
      try {
        await services.openTabs(tabs);
        closePopup();
      } catch (error) {
        console.error("Unable to open selected tabs:", error);
        setStatus({
          kind: "error",
          text:
            error instanceof OpenedTabsCleanupError
              ? error.message
              : "Some tabs could not be opened. Try a smaller selection.",
        });
      } finally {
        setOpeningMode(null);
      }
    },
    [closePopup, services],
  );

  const viewTabs = viewDevices.flatMap((device) => device.tabs);
  const openAll = useCallback(() => runOpen(viewTabs, "all"), [runOpen, viewTabs]);
  const openSelected = useCallback(
    () =>
      runOpen(
        viewTabs.filter((tab) => selected.has(tab.id)),
        "selected",
      ),
    [runOpen, selected, viewTabs],
  );

  return {
    activeView,
    allVisibleSelected,
    deleteTab,
    filter,
    history,
    loading,
    openAll,
    openSelected,
    openedTabIds,
    openingMode,
    refresh,
    selected,
    selectedCount,
    setActiveView,
    setFilter,
    status,
    toggleDevice,
    toggleTab,
    toggleVisibleSelection,
    totalTabs,
    viewDevices,
    visibleDevices,
    visibleTabIds,
  };
}

function updateSelection(
  current: ReadonlySet<string>,
  ids: string[],
  checked: boolean,
): Set<string> {
  const updated = new Set(current);
  for (const id of ids) {
    if (checked) {
      updated.add(id);
    } else {
      updated.delete(id);
    }
  }
  return updated;
}

function removeStaleSelections(current: ReadonlySet<string>, devices: Device[]): Set<string> {
  const validIds = new Set(devices.flatMap((device) => device.tabs.map((tab) => tab.id)));
  return new Set([...current].filter((id) => validIds.has(id)));
}

function removeTab(devices: Device[], tabId: string): Device[] {
  return devices
    .map((device) => ({ ...device, tabs: device.tabs.filter((tab) => tab.id !== tabId) }))
    .filter((device) => device.tabs.length > 0);
}
