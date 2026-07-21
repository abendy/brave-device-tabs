import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { OptionsApp } from "./OptionsApp";
import { optionsServices } from "./options-services";
import { previewOptionsServices } from "./preview-options-services";

const rootElement = document.querySelector("#root");
if (!rootElement) {
  throw new Error("Options root element is missing.");
}

const extensionApiAvailable = typeof chrome !== "undefined" && Boolean(chrome.storage);
const services =
  import.meta.env.DEV && !extensionApiAvailable ? previewOptionsServices : optionsServices;

createRoot(rootElement).render(
  <StrictMode>
    <OptionsApp services={services} />
  </StrictMode>,
);
