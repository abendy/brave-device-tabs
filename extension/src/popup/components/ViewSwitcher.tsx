import type { ActiveView } from "../types";

interface ViewSwitcherProps {
  activeView: ActiveView;
  onChange(view: ActiveView): void;
}

export function ViewSwitcher({ activeView, onChange }: ViewSwitcherProps) {
  return (
    <div aria-label="View" className="view-switcher" role="tablist">
      <button
        aria-controls="tabs-view"
        aria-selected={activeView === "tabs"}
        className={`view-tab${activeView === "tabs" ? " is-active" : ""}`}
        id="tabs-view-button"
        onClick={() => onChange("tabs")}
        role="tab"
        type="button"
      >
        Tabs
      </button>
      <button
        aria-controls="opened-view"
        aria-selected={activeView === "opened"}
        className={`view-tab${activeView === "opened" ? " is-active" : ""}`}
        id="opened-view-button"
        onClick={() => onChange("opened")}
        role="tab"
        type="button"
      >
        Opened
      </button>
    </div>
  );
}
