import { useEffect, useRef } from "react";
import { pluralize } from "../domain";
import type { DeviceTab, VisibleDevice } from "../types";
import { EmptyState } from "./EmptyState";
import { TrashIcon } from "./Icons";

interface DeviceListProps {
  devicesExist: boolean;
  emptyCopy: string;
  emptyTitle: string;
  filtered: boolean;
  loading: boolean;
  onDelete(tabId: string): void;
  onToggleDevice(deviceId: string, checked: boolean): void;
  onToggleTab(tabId: string, checked: boolean): void;
  selected: ReadonlySet<string>;
  visibleDevices: VisibleDevice[];
}

export function DeviceList(props: DeviceListProps) {
  const { devicesExist, emptyCopy, emptyTitle, filtered, loading, visibleDevices } = props;
  if (!loading && !devicesExist) {
    return (
      <div aria-live="polite" className="device-list">
        <EmptyState copy={emptyCopy} title={emptyTitle} />
      </div>
    );
  }
  if (!loading && filtered && visibleDevices.length === 0) {
    return (
      <div aria-live="polite" className="device-list">
        <EmptyState copy="Try a different title, URL, or device name." title="No matching tabs" />
      </div>
    );
  }

  return (
    <div aria-live="polite" className="device-list">
      {visibleDevices.map((entry) => (
        <DeviceSection entry={entry} key={entry.device.id} {...props} />
      ))}
    </div>
  );
}

interface DeviceSectionProps extends DeviceListProps {
  entry: VisibleDevice;
}

function DeviceSection({
  entry,
  filtered,
  onDelete,
  onToggleDevice,
  onToggleTab,
  selected,
}: DeviceSectionProps) {
  const { device, tabs } = entry;
  const selectedCount = tabs.filter((tab) => selected.has(tab.id)).length;
  const checked = tabs.length > 0 && selectedCount === tabs.length;
  const indeterminate = selectedCount > 0 && selectedCount < tabs.length;
  const checkbox = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (checkbox.current) {
      checkbox.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <section className="device">
      <div className="device-header">
        <label className="device-select">
          <input
            checked={checked}
            onChange={(event) => onToggleDevice(device.id, event.currentTarget.checked)}
            ref={checkbox}
            type="checkbox"
          />
          <span aria-hidden="true" className="custom-checkbox" />
          <span className="device-name" title={device.name}>
            {device.name}
          </span>
        </label>
        <span className="device-count">
          {filtered
            ? `${tabs.length} of ${device.tabs.length}`
            : `${device.tabs.length} ${pluralize(device.tabs.length, "tab")}`}
        </span>
      </div>
      <div className="tabs">
        {tabs.map((tab) => (
          <TabRow
            checked={selected.has(tab.id)}
            key={tab.id}
            onDelete={onDelete}
            onToggle={onToggleTab}
            tab={tab}
          />
        ))}
      </div>
    </section>
  );
}

interface TabRowProps {
  checked: boolean;
  onDelete(tabId: string): void;
  onToggle(tabId: string, checked: boolean): void;
  tab: DeviceTab;
}

function TabRow({ checked, onDelete, onToggle, tab }: TabRowProps) {
  return (
    <div className="tab-row">
      <label className="tab-row-main">
        <input
          checked={checked}
          onChange={(event) => onToggle(tab.id, event.currentTarget.checked)}
          type="checkbox"
        />
        <span aria-hidden="true" className="custom-checkbox" />
        <span className="tab-copy">
          <span className="tab-title" title={tab.title}>
            {tab.title}
          </span>
          <span className="tab-url" title={tab.url}>
            {tab.url}
          </span>
        </span>
      </label>
      {tab.id.startsWith("shared:") ? (
        <button
          aria-label={`Discard ${tab.title}`}
          className="tab-delete-button"
          onClick={() => onDelete(tab.id)}
          title="Discard"
          type="button"
        >
          <TrashIcon />
        </button>
      ) : null}
    </div>
  );
}
