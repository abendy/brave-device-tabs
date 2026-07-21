import { type FormEvent, useCallback, useEffect, useState } from "react";
import type { OptionsServices } from "./options-services";
import { normalizeServerUrl } from "./server";

export interface OptionsForm {
  email: string;
  password: string;
  serverUrl: string;
}

export interface OptionsStatus {
  kind: "error" | "info";
  text: string;
}

export type OptionsBusy = "connecting" | "disconnecting" | null;

export interface OptionsController {
  busy: OptionsBusy;
  connectedUrl: string | null;
  disconnect(): void;
  form: OptionsForm;
  loaded: boolean;
  setField(field: keyof OptionsForm, value: string): void;
  status: OptionsStatus | null;
  submit(event: FormEvent<HTMLFormElement>): void;
}

interface ConnectActionOptions {
  form: OptionsForm;
  services: OptionsServices;
  setBusy(value: OptionsBusy): void;
  setConnectedUrl(value: string | null): void;
  setForm(updater: (current: OptionsForm) => OptionsForm): void;
  setStatus(value: OptionsStatus | null): void;
}

const EMPTY_FORM: OptionsForm = { email: "", password: "", serverUrl: "" };

export function useOptionsController(services: OptionsServices): OptionsController {
  const [busy, setBusy] = useState<OptionsBusy>(null);
  const [connectedUrl, setConnectedUrl] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<OptionsStatus | null>(null);

  useLoadConnection(services, setConnectedUrl, setLoaded, setStatus);
  const submit = useConnectAction({ form, services, setBusy, setConnectedUrl, setForm, setStatus });
  const disconnect = useDisconnectAction(services, setBusy, setConnectedUrl, setStatus);
  const setField = useCallback((field: keyof OptionsForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  }, []);

  return { busy, connectedUrl, disconnect, form, loaded, setField, status, submit };
}

function useLoadConnection(
  services: OptionsServices,
  setConnectedUrl: (value: string | null) => void,
  setLoaded: (value: boolean) => void,
  setStatus: (value: OptionsStatus | null) => void,
): void {
  useEffect(() => {
    let active = true;
    void services
      .loadServerUrl()
      .then((serverUrl) => {
        if (active) {
          setConnectedUrl(serverUrl);
        }
      })
      .catch((error: unknown) => {
        console.error("Could not load Shared Links settings:", error);
        if (active) {
          setStatus({ kind: "error", text: "Could not load settings. Try reloading the page." });
        }
      })
      .finally(() => {
        if (active) {
          setLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, [services, setConnectedUrl, setLoaded, setStatus]);
}

function useConnectAction(options: ConnectActionOptions) {
  return useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      let serverUrl: string;
      try {
        serverUrl = normalizeServerUrl(options.form.serverUrl.trim());
      } catch {
        options.setStatus({
          kind: "error",
          text: "Enter a valid server URL, e.g. https://your-app.fly.dev",
        });
        return;
      }

      options.setBusy("connecting");
      options.setStatus(null);
      const connection = options.services.connect(
        serverUrl,
        options.form.email.trim(),
        options.form.password,
      );
      void connection
        .then(() => {
          options.setConnectedUrl(serverUrl);
          options.setForm((current) => ({ ...current, password: "" }));
        })
        .catch((error: unknown) => {
          console.error("Sign-in failed:", error);
          options.setStatus({
            kind: "error",
            text: error instanceof Error ? error.message : "Sign-in failed.",
          });
        })
        .finally(() => options.setBusy(null));
    },
    [options],
  );
}

function useDisconnectAction(
  services: OptionsServices,
  setBusy: (value: OptionsBusy) => void,
  setConnectedUrl: (value: string | null) => void,
  setStatus: (value: OptionsStatus | null) => void,
) {
  return useCallback(() => {
    setBusy("disconnecting");
    setStatus(null);
    void services
      .disconnect()
      .then(() => setConnectedUrl(null))
      .catch((error: unknown) => {
        console.error("Sign-out failed:", error);
        setStatus({ kind: "error", text: "Could not sign out. Try again." });
      })
      .finally(() => setBusy(null));
  }, [services, setBusy, setConnectedUrl, setStatus]);
}
