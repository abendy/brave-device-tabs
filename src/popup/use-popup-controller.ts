import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { filterOpenedTabs, getOpenedIdSet, getVisibleDevices } from "./domain";
import type { PopupServices } from "./popup-services";
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
  devices: Device[];
  filter: string;
  history: OpenedBatch[];
  loading: boolean;
  openAll(): Promise<void>;
  openSelected(): Promise<void>;
  openingMode: OpeningMode;
  refresh(): Promise<void>;
  selected: ReadonlySet<string>;
  setActiveView(view: ActiveView): void;
  setFilter(value: string): void;
  status: StatusMessage | null;
  toggleDevice(deviceId: string, checked: boolean): void;
  toggleTab(tabId: string, checked: boolean): void;
  toggleVisibleSelection(): void;
  visibleDevices: VisibleDevice[];
  visibleTabIds: string[];
}

export function usePopupController(
  services: PopupServices,
  closePopup: () => void,
): PopupController {
  const [activeView, setActiveView] = useState<ActiveView>("tabs");
  const [devices, setDevices] = useState<Device[]>([]);
  const [filter, setFilterValue] = useState("");
  const [history, setHistory] = useState<OpenedBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [openingMode, setOpeningMode] = useState<OpeningMode>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const refreshing = useRef(false);
  const normalizedFilter = useMemo(() => filter.trim().toLocaleLowerCase(), [filter]);

  const visibleDevices = useMemo(
    () => getVisibleDevices(devices, normalizedFilter),
    [devices, normalizedFilter],
  );
  const visibleTabIds = useMemo(
    () => visibleDevices.flatMap((entry) => entry.tabs.map((tab) => tab.id)),
    [visibleDevices],
  );
  const allVisibleSelected =
    visibleTabIds.length > 0 && visibleTabIds.every((id) => selected.has(id));

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
      const openedIds = getOpenedIdSet(openedHistory);
      const nextDevices = [
        ...filterOpenedTabs(sharedDevices, openedIds),
        ...filterOpenedTabs(syncedResult.devices, openedIds),
      ];

      setHistory(openedHistory);
      setDevices(nextDevices);
      setSelected((current) => removeStaleSelections(current, nextDevices));
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
          setDevices((current) => removeTab(current, tabId));
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
          text: "Some tabs could not be opened. Try a smaller selection.",
        });
      } finally {
        setOpeningMode(null);
      }
    },
    [closePopup, services],
  );

  const allTabs = devices.flatMap((device) => device.tabs);
  const openAll = useCallback(() => runOpen(allTabs, "all"), [allTabs, runOpen]);
  const openSelected = useCallback(
    () =>
      runOpen(
        allTabs.filter((tab) => selected.has(tab.id)),
        "selected",
      ),
    [allTabs, runOpen, selected],
  );

  return {
    activeView,
    allVisibleSelected,
    deleteTab,
    devices,
    filter,
    history,
    loading,
    openAll,
    openSelected,
    openingMode,
    refresh,
    selected,
    setActiveView,
    setFilter,
    status,
    toggleDevice,
    toggleTab,
    toggleVisibleSelection,
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
