import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { popupServices } from "./popup-services";
import { previewServices } from "./preview-services";

const rootElement = document.querySelector("#root");
if (!rootElement) {
  throw new Error("Popup root element is missing.");
}

const extensionApiAvailable = typeof chrome !== "undefined" && Boolean(chrome.sessions);
const services = import.meta.env.DEV && !extensionApiAvailable ? previewServices : popupServices;

createRoot(rootElement).render(
  <StrictMode>
    <App services={services} />
  </StrictMode>,
);
