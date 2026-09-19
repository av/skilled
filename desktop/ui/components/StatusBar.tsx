import type { Snapshot } from "../lib/bridge";
import type { Derived, View } from "../lib/model";
import { timeAgo } from "../../../src/data";

interface Props { snapshot: Snapshot | null; derived: Derived; loading: boolean; detail: boolean; view: View; toast: string | null; mod: string }

export function StatusBar({ snapshot, derived, loading, detail, view, toast, mod }: Props) {
  const hints = view === "dashboard"
    ? detail
      ? [["Esc", "close"], ["j/k", "next skill"], ["a", "audit"], ["r", "refresh"]]
      : [["s", "sort"], ["Tab", "direction"], ["j/k", "select"], ["⏎", "detail"], ["/", "filter"], ["a", "audit"], ["r", "refresh"], [`${mod}+1…5`, "views"]]
    : [["Esc", "dashboard"], ["r", "refresh"], [`${mod}+E`, "export"], [`${mod}+1…5`, "views"]];
  return (
    <footer className="statusbar">
      <div className="hints">{hints.map(([k, l]) => <span key={k}><kbd>{k}</kbd> {l}</span>)}</div>
      <div className="status" aria-live="polite">
        {toast ? <span className="toast">{toast}</span> : snapshot ? (
          <>
            <span className={`reader ${snapshot.reader}`} title={snapshot.reader === "rustIndex" ? `Rust index at ${snapshot.dbPath}` : "TypeScript providers via the skilled CLI"}>{snapshot.reader === "rustIndex" ? "rust index" : "ts fallback"}</span>
            <span>{derived.filtered.length.toLocaleString()} calls</span>
            <span title={new Date(snapshot.indexedAtMs).toLocaleString()}>indexed {timeAgo(new Date(snapshot.indexedAtMs))} ago{snapshot.reindexed ? "" : " (cached)"}</span>
            {loading && <span className="spinner" aria-label="loading" />}
          </>
        ) : <span>…</span>}
      </div>
    </footer>
  );
}
