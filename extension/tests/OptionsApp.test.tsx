// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OptionsApp } from "../src/options/OptionsApp";
import type { OptionsServices } from "../src/options/options-services";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("OptionsApp", () => {
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

  it("connects with normalized form values and then signs out", async () => {
    const connect = vi.fn(async () => undefined);
    const disconnect = vi.fn(async () => undefined);
    const services = createServices({ connect, disconnect });
    await renderOptions(root, services);

    await setField(container, "serverUrl", "example.com/path");
    await setField(container, "email", "  person@example.com ");
    await setField(container, "password", "secret");
    await submitForm(container);

    expect(connect).toHaveBeenCalledWith("https://example.com", "person@example.com", "secret");
    expect(container.textContent).toContain("Connected to https://example.com");

    await clickButton(container, "Sign Out");
    expect(disconnect).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Sign In");
  });

  it("shows an existing connection without rendering the setup form", async () => {
    const services = createServices({ loadServerUrl: async () => "https://links.example.com" });
    await renderOptions(root, services);

    expect(container.textContent).toContain("Connected to https://links.example.com");
    expect(container.querySelector("#setup-form")).toBeNull();
  });

  it("reports an invalid server URL without requesting a connection", async () => {
    const connect = vi.fn(async () => undefined);
    const services = createServices({ connect });
    await renderOptions(root, services);

    await setField(container, "serverUrl", "http://[");
    await setField(container, "email", "person@example.com");
    await setField(container, "password", "secret");
    await submitForm(container);

    expect(connect).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Enter a valid server URL");
  });
});

async function renderOptions(root: Root, services: OptionsServices): Promise<void> {
  await act(async () => root.render(<OptionsApp services={services} />));
}

async function setField(container: ParentNode, name: string, value: string): Promise<void> {
  const input = requiredElement<HTMLInputElement>(container, `input[name='${name}']`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) {
    throw new Error("Input value setter is unavailable.");
  }
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submitForm(container: ParentNode): Promise<void> {
  const form = requiredElement<HTMLFormElement>(container, "#setup-form");
  await act(async () => {
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
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

function createServices(overrides: Partial<OptionsServices> = {}): OptionsServices {
  return {
    connect: async () => undefined,
    disconnect: async () => undefined,
    loadServerUrl: async () => null,
    ...overrides,
  };
}
