import type { ActiveView } from "../types";

interface ViewSwitcherProps {
  activeView: ActiveView;
  onChange(view: ActiveView): void;
}

const TABS: Array<{ id: ActiveView; label: string }> = [
  { id: "links", label: "Links" },
  { id: "devices", label: "Devices" },
  { id: "opened", label: "Opened" },
];

export function ViewSwitcher({ activeView, onChange }: ViewSwitcherProps) {
  return (
    <div aria-label="View" className="view-switcher" role="tablist">
      {TABS.map(({ id, label }) => (
        <button
          aria-controls={`${id}-view`}
          aria-selected={activeView === id}
          className={`view-tab${activeView === id ? " is-active" : ""}`}
          id={`${id}-view-button`}
          key={id}
          onClick={() => onChange(id)}
          role="tab"
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  );
}
