import { pluralize } from "../domain";
import type { Device, StatusMessage, VisibleDevice } from "../types";
import { DeviceList } from "./DeviceList";
import { SearchIcon } from "./Icons";
import { Status } from "./Status";

interface TabsViewProps {
  allVisibleSelected: boolean;
  devices: Device[];
  emptyCopy: string;
  emptyTitle: string;
  filter: string;
  filterPlaceholder: string;
  groupNoun: string;
  loading: boolean;
  loadingCopy: string;
  onDelete(tabId: string): void;
  onFilter(value: string): void;
  onToggleDevice(deviceId: string, checked: boolean): void;
  onToggleTab(tabId: string, checked: boolean): void;
  onToggleVisible(): void;
  openedTabIds: ReadonlySet<string>;
  panelId: string;
  panelLabelledBy: string;
  selected: ReadonlySet<string>;
  status: StatusMessage | null;
  visibleDevices: VisibleDevice[];
  visibleTabCount: number;
}

export function TabsView(props: TabsViewProps) {
  const totalTabs = props.devices.reduce((sum, device) => sum + device.tabs.length, 0);
  const summary = props.loading
    ? props.loadingCopy
    : `${props.devices.length} ${pluralize(props.devices.length, props.groupNoun)} · ${totalTabs} ${pluralize(totalTabs, "tab")}`;

  return (
    <div aria-labelledby={props.panelLabelledBy} id={props.panelId} role="tabpanel">
      <p aria-live="polite" className="summary">
        {summary}
      </p>
      <section aria-label="Tab controls" className="toolbar">
        <label className="search">
          <span className="visually-hidden">Filter tabs</span>
          <SearchIcon />
          <input
            autoComplete="off"
            disabled={props.loading}
            onChange={(event) => props.onFilter(event.currentTarget.value)}
            placeholder={props.filterPlaceholder}
            type="search"
            value={props.filter}
          />
        </label>
        <button
          className="text-button"
          disabled={props.visibleTabCount === 0}
          onClick={props.onToggleVisible}
          type="button"
        >
          {props.allVisibleSelected ? "Clear visible" : "Select visible"}
        </button>
      </section>
      <Status message={props.status} />
      <DeviceList
        devicesExist={props.devices.length > 0}
        emptyCopy={props.emptyCopy}
        emptyTitle={props.emptyTitle}
        filtered={Boolean(props.filter.trim())}
        loading={props.loading}
        onDelete={props.onDelete}
        onToggleDevice={props.onToggleDevice}
        onToggleTab={props.onToggleTab}
        openedTabIds={props.openedTabIds}
        selected={props.selected}
        visibleDevices={props.visibleDevices}
      />
    </div>
  );
}
