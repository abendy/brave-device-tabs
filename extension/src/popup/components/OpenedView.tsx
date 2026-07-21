import { formatBatchTime } from "../domain";
import type { OpenedBatch } from "../types";
import { EmptyState } from "./EmptyState";

interface OpenedViewProps {
  history: OpenedBatch[];
}

export function OpenedView({ history }: OpenedViewProps) {
  return (
    <div aria-labelledby="opened-view-button" id="opened-view" role="tabpanel">
      <div aria-live="polite" className="device-list opened-list">
        {history.length === 0 ? (
          <EmptyState
            copy="Tabs you open from here show up as history, grouped by when you opened them."
            title="Nothing opened yet"
          />
        ) : (
          history.map((batch) => <OpenedBatchView batch={batch} key={batch.id} />)
        )}
      </div>
    </div>
  );
}

function OpenedBatchView({ batch }: { batch: OpenedBatch }) {
  return (
    <section className="opened-batch">
      <div className="opened-batch-header">{formatBatchTime(batch.openedAt)}</div>
      <div className="opened-batch-items">
        {batch.items.map((item) => (
          <div className="opened-row" key={`${batch.id}-${item.id}`}>
            <span className="opened-title" title={item.title}>
              {item.title}
            </span>
            <span className="opened-meta" title={item.url}>
              {item.source} · {item.url}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
