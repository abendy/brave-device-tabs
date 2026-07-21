import type { OpeningMode } from "../types";

interface FooterProps {
  loading: boolean;
  onOpenAll(): void;
  onOpenSelected(): void;
  openingMode: OpeningMode;
  selectedCount: number;
  totalTabs: number;
}

export function Footer(props: FooterProps) {
  const busy = props.loading || props.openingMode !== null;
  return (
    <footer className="footer">
      <span className="selection-count">{props.selectedCount} selected</span>
      <div className="footer-actions">
        <button
          className="secondary-button"
          disabled={props.totalTabs === 0 || busy}
          onClick={props.onOpenAll}
          type="button"
        >
          {props.openingMode === "all"
            ? "Opening…"
            : props.totalTabs > 0
              ? `Open all (${props.totalTabs})`
              : "Open all"}
        </button>
        <button
          className="primary-button"
          disabled={props.selectedCount === 0 || busy}
          onClick={props.onOpenSelected}
          type="button"
        >
          {props.openingMode === "selected"
            ? "Opening…"
            : props.selectedCount > 0
              ? `Open selected (${props.selectedCount})`
              : "Open selected"}
        </button>
      </div>
    </footer>
  );
}
