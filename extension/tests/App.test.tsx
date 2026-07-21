// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/popup/App";
import type { PopupServices } from "../src/popup/popup-services";
import type { Device, DeviceTab } from "../src/popup/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("App", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("defaults to the Links view and hides synced device tabs until switching", async () => {
    await renderApp(root, servicesWith([device(tab("alpha", "Alpha article"))]), vi.fn());

    expect(container.textContent).toContain("No shared links yet");
    expect(container.textContent).not.toContain("Alpha article");

    await clickButton(container, "Devices");
    expect(container.textContent).toContain("Alpha article");
  });

  it("keeps a synced device tab visible after opening it, labeled Opened", async () => {
    const alpha = tab("alpha", "Alpha article");
    const services = servicesWith([device(alpha)]);
    services.loadOpenedHistory = async () => [
      {
        id: "batch",
        items: [
          { id: "alpha", source: "Phone", title: "Alpha article", url: "https://alpha.test" },
        ],
        openedAt: new Date().toISOString(),
      },
    ];

    await renderApp(root, services, vi.fn());
    await clickButton(container, "Devices");

    expect(container.textContent).toContain("Alpha article");
    expect(container.querySelector(".tab-opened-badge")?.textContent).toBe("Opened");
  });

  it("filters, selects visible tabs, and opens only the selection", async () => {
    const alpha = tab("alpha", "Alpha article");
    const beta = tab("beta", "Beta article");
    const openTabs = vi.fn(async () => undefined);
    const closePopup = vi.fn();

    await renderApp(root, servicesWith([device(alpha, beta)], openTabs), closePopup);
    await clickButton(container, "Devices");
    expect(container.textContent).toContain("1 device · 2 tabs");

    const search = requiredElement<HTMLInputElement>(container, "input[type='search']");
    await act(async () => {
      setInputValue(search, "  ALPHA ");
    });
    expect(search.value).toBe("  ALPHA ");
    expect(container.textContent).toContain("1 of 2");
    expect(container.textContent).not.toContain("Beta article");

    await clickButton(container, "Select visible");
    expect(container.textContent).toContain("Open selected (1)");
    await clickButton(container, "Open selected (1)");

    expect(openTabs).toHaveBeenCalledWith([alpha]);
    expect(closePopup).toHaveBeenCalledOnce();
  });

  it("shows opened history in the Opened view", async () => {
    const services = servicesWith([device(tab("alpha", "Alpha article"))]);
    services.loadOpenedHistory = async () => [
      {
        id: "batch",
        items: [
          { id: "opened", source: "Phone", title: "Opened article", url: "https://opened.test" },
        ],
        openedAt: new Date().toISOString(),
      },
    ];

    await renderApp(root, services, vi.fn());
    await clickButton(container, "Opened");

    expect(container.textContent).toContain("Opened article");
    expect(container.textContent).not.toContain("Open selected");
  });

  it("discards a shared link and removes its empty device", async () => {
    const shared = { ...tab("shared:discard", "Shared article"), id: "shared:discard" };
    const discard = vi.fn(async () => true);
    const services = servicesWith([]);
    services.deleteSharedLink = discard;
    services.loadSharedLinksDevices = async () => [
      { id: "shared-links:none", name: "Shared Links", tabs: [shared] },
    ];

    await renderApp(root, services, vi.fn());
    const button = requiredElement<HTMLButtonElement>(
      container,
      "button[aria-label='Discard Shared article']",
    );
    await act(async () => button.click());

    expect(discard).toHaveBeenCalledWith("shared:discard");
    expect(container.textContent).not.toContain("Shared article");
    expect(container.textContent).toContain("No shared links yet");
  });
});

async function renderApp(
  root: Root,
  services: PopupServices,
  closePopup: () => void,
): Promise<void> {
  await act(async () => {
    root.render(<App closePopup={closePopup} services={services} />);
  });
}

async function clickButton(container: ParentNode, label: string): Promise<void> {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!button) {
    throw new Error(`Missing button: ${label}`);
  }
  await act(async () => button.click());
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) {
    throw new Error("Input value setter is unavailable.");
  }
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function requiredElement<ElementType extends Element>(
  container: ParentNode,
  selector: string,
): ElementType {
  const element = container.querySelector<ElementType>(selector);
  if (!element) {
    throw new Error(`Missing element: ${selector}`);
  }
  return element;
}

function servicesWith(devices: Device[], openTabs = vi.fn(async () => undefined)): PopupServices {
  return {
    deleteSharedLink: async () => true,
    loadOpenedHistory: async () => [],
    loadSharedLinksDevices: async () => [],
    loadSyncedDevices: async () => ({ devices, error: null }),
    openOptionsPage: vi.fn(),
    openTabs,
    syncTabGroupsToServer: async () => undefined,
  };
}

function device(...tabs: DeviceTab[]): Device {
  return { id: "device-phone", name: "Phone", tabs };
}

function tab(id: string, title: string): DeviceTab {
  return {
    destination: null,
    id,
    searchable: `phone ${title} https://${id}.test`.toLocaleLowerCase(),
    source: "Phone",
    title,
    url: `https://${id}.test`,
  };
}
