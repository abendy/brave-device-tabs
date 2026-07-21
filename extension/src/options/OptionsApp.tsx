import { AquaHeader } from "../shared/AquaHeader";
import type { OptionsServices } from "./options-services";
import {
  type OptionsForm,
  type OptionsStatus,
  useOptionsController,
} from "./use-options-controller";

interface OptionsAppProps {
  services: OptionsServices;
}

export function OptionsApp({ services }: OptionsAppProps) {
  const controller = useOptionsController(services);
  return (
    <main aria-labelledby="app-title" className="app">
      <AquaHeader emphasis="links" title="Shared" />
      <div className="options-body-inner">
        <p className="options-intro">
          Connect the extension to your PocketBase server so links shared from your iPhone show up
          here as a “Shared Links” device. Leave this unset and the extension behaves exactly as
          before.
        </p>
        <OptionsStatusView status={controller.status} />
        {controller.loaded ? (
          controller.connectedUrl ? (
            <ConnectedPanel
              busy={controller.busy === "disconnecting"}
              onDisconnect={controller.disconnect}
              serverUrl={controller.connectedUrl}
            />
          ) : (
            <SetupForm
              busy={controller.busy === "connecting"}
              form={controller.form}
              onChange={controller.setField}
              onSubmit={controller.submit}
            />
          )
        ) : (
          <p aria-live="polite" className="options-loading">
            Loading settings…
          </p>
        )}
      </div>
    </main>
  );
}

function OptionsStatusView({ status }: { status: OptionsStatus | null }) {
  return status ? (
    <div className={`status${status.kind === "error" ? " error" : ""}`} role="status">
      {status.text}
    </div>
  ) : null;
}

interface ConnectedPanelProps {
  busy: boolean;
  onDisconnect(): void;
  serverUrl: string;
}

function ConnectedPanel({ busy, onDisconnect, serverUrl }: ConnectedPanelProps) {
  return (
    <section className="options-panel" id="connected-panel">
      <p className="options-connected">
        Connected to <strong>{serverUrl}</strong>
      </p>
      <button
        className="secondary-button"
        disabled={busy}
        id="sign-out-button"
        onClick={onDisconnect}
        type="button"
      >
        {busy ? "Signing out…" : "Sign Out"}
      </button>
    </section>
  );
}

interface SetupFormProps {
  busy: boolean;
  form: OptionsForm;
  onChange(field: keyof OptionsForm, value: string): void;
  onSubmit: React.FormEventHandler<HTMLFormElement>;
}

function SetupForm({ busy, form, onChange, onSubmit }: SetupFormProps) {
  return (
    <form className="options-panel" id="setup-form" onSubmit={onSubmit}>
      <Field
        autoComplete="off"
        label="Server URL"
        name="serverUrl"
        onChange={onChange}
        placeholder="https://your-app.fly.dev"
        type="url"
        value={form.serverUrl}
      />
      <Field
        autoComplete="username"
        label="Email"
        name="email"
        onChange={onChange}
        type="email"
        value={form.email}
      />
      <Field
        autoComplete="current-password"
        label="Password"
        name="password"
        onChange={onChange}
        type="password"
        value={form.password}
      />
      <button className="primary-button" disabled={busy} id="sign-in-button" type="submit">
        {busy ? "Signing in…" : "Sign In"}
      </button>
    </form>
  );
}

interface FieldProps {
  autoComplete: string;
  label: string;
  name: keyof OptionsForm;
  onChange(field: keyof OptionsForm, value: string): void;
  placeholder?: string;
  type: "email" | "password" | "url";
  value: string;
}

function Field({ autoComplete, label, name, onChange, placeholder, type, value }: FieldProps) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        autoComplete={autoComplete}
        name={name}
        onChange={(event) => onChange(name, event.currentTarget.value)}
        placeholder={placeholder}
        required
        type={type}
        value={value}
      />
    </label>
  );
}
