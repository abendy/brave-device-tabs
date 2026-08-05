export interface DeviceTab {
  destination: string | null;
  /** Window the destination targets; only shared links with a stored positive value carry it. */
  destinationWindowId?: number;
  id: string;
  searchable: string;
  source: string;
  title: string;
  url: string;
}

export interface Device {
  id: string;
  name: string;
  tabs: DeviceTab[];
}

export interface OpenedHistoryItem {
  id: string;
  source: string;
  title: string;
  url: string;
}

export interface OpenedBatch {
  id: string;
  items: OpenedHistoryItem[];
  openedAt: string;
}

export interface LoadSyncedDevicesResult {
  devices: Device[];
  error: string | null;
}

export interface StatusMessage {
  kind: "error" | "info";
  text: string;
}

export interface VisibleDevice {
  device: Device;
  tabs: DeviceTab[];
}

export type ActiveView = "devices" | "links" | "opened";
export type OpeningMode = "all" | "selected" | null;
