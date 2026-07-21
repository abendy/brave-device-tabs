import type { PopupServices } from "./popup-services";
import type { Device, OpenedBatch } from "./types";

const previewDevices: Device[] = [
  {
    id: "shared-links:none",
    name: "Shared Links",
    tabs: [
      {
        destination: null,
        id: "shared:preview-one",
        searchable: "shared links iphone field notes example.com/field-notes",
        source: "iPhone",
        title: "Field notes for the weekend",
        url: "https://example.com/field-notes",
      },
    ],
  },
  {
    id: "device-preview-iphone",
    name: "Andrew’s iPhone",
    tabs: [
      {
        destination: null,
        id: "sync:preview-one",
        searchable: "andrew’s iphone brave browser release notes brave.com/latest",
        source: "Andrew’s iPhone",
        title: "Brave Browser release notes",
        url: "https://brave.com/latest/",
      },
      {
        destination: null,
        id: "sync:preview-two",
        searchable: "andrew’s iphone local-first software inkandswitch.com/local-first",
        source: "Andrew’s iPhone",
        title: "Local-first software",
        url: "https://www.inkandswitch.com/local-first/",
      },
    ],
  },
];

const previewHistory: OpenedBatch[] = [
  {
    id: "preview-history",
    items: [
      {
        id: "sync:opened-preview",
        source: "Andrew’s iPhone",
        title: "Previously opened tab",
        url: "https://example.com/opened",
      },
    ],
    openedAt: new Date().toISOString(),
  },
];

export const previewServices: PopupServices = {
  deleteSharedLink: async () => true,
  loadOpenedHistory: async () => previewHistory,
  loadSharedLinksDevices: async () => previewDevices.slice(0, 1),
  loadSyncedDevices: async () => ({
    devices: previewDevices.slice(1),
    error: null,
  }),
  openOptionsPage: () => undefined,
  openTabs: async () => undefined,
  syncTabGroupsToServer: async () => undefined,
};
