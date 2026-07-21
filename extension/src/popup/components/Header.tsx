import { AquaHeader } from "../../shared/AquaHeader";
import { RefreshIcon, SettingsIcon } from "./Icons";

interface HeaderProps {
  busy: boolean;
  onOpenSettings(): void;
  onRefresh(): void;
}

export function Header({ busy, onOpenSettings, onRefresh }: HeaderProps) {
  return (
    <AquaHeader emphasis="tabs" title="Device">
      <button
        aria-label="Open Shared Links settings"
        className="icon-button"
        onClick={onOpenSettings}
        title="Shared Links settings"
        type="button"
      >
        <SettingsIcon />
      </button>
      <button
        aria-label="Refresh synced tabs"
        className={`icon-button${busy ? " is-spinning" : ""}`}
        disabled={busy}
        onClick={onRefresh}
        title="Refresh"
        type="button"
      >
        <RefreshIcon />
      </button>
    </AquaHeader>
  );
}
