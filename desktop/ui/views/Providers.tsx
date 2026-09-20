import { backend, type AppInfo, type Snapshot } from "../lib/bridge";
import { fmtDateTime } from "../lib/model";

interface Props { snapshot: Snapshot; info: AppInfo | null; onNotify: (m: string) => void }

const READS: Record<string, string> = {
  "claude-code": "history.jsonl + projects/**/*.jsonl (Skill tool_use)",
  codex: "sessions/**/*.jsonl (<skill><name> in input_text)",
  droid: "sessions/*.jsonl ('Skill \"x\" is now active')",
  opencode: "opencode.db (part.tool = skill, completed)",
  grok: "sessions/<project>/<session>/updates.jsonl + chat_history.jsonl",
};

export function Providers({ snapshot, info, onNotify }: Props) {
  const reveal = async (path: string) => {
    const b = await backend();
    if (!(await b.pathExists(path))) { onNotify(`Path does not exist: ${path}`); return; }
    try { await b.revealPath(path); } catch (e) { onNotify(String(e)); }
  };
  const indexed = new Date(snapshot.indexedAtMs);
  return (
    <div className="providers">
      <section className="panel index-status" aria-label="Index status">
        <h2>Reader</h2>
        <div className="kv wide">
          <div><span className="k">Active reader</span><span className={`v reader ${snapshot.reader}`}>{snapshot.reader === "rustIndex" ? "Rust index (in-process skilled-index)" : "TypeScript providers via `skilled --no-index`"}</span></div>
          <div><span className="k">Last indexed</span><span className="v" title={fmtDateTime(indexed)}>{fmtDateTime(indexed)} <span className="muted">{snapshot.reindexed ? "re-parsed this refresh" : "fresh index reused"}</span></span></div>
          <div><span className="k">Index file</span><span className="v mono">{snapshot.dbPath || "—"} {snapshot.dbPath && <button className="link" onClick={() => void reveal(snapshot.dbPath)}>reveal</button>}</span></div>
          <div><span className="k">Versions</span><span className="v">index {snapshot.indexVersion ?? "—"} · app {info?.version ?? "?"} · {info?.platform}</span></div>
          <div><span className="k">Scan time</span><span className="v">{snapshot.elapsedMs} ms</span></div>
          <div><span className="k">skilled CLI</span><span className="v">{info?.cliAvailable ? "found on PATH (fallback available)" : "not installed (fallback unavailable)"}</span></div>
        </div>
        {snapshot.warnings.map((w, i) => <div key={i} className="warning">{w}</div>)}
        <p className="muted note">Local files only. Skilled never sends data anywhere; there is no network access in this app.</p>
      </section>
      <section className="panel" aria-label="Providers">
        <h2>Providers <span className="muted">{snapshot.providers.filter(p => p.available).length} of {snapshot.providers.length} detected</span></h2>
        <table className="providers-table">
          <thead><tr><th>Tool</th><th>Status</th><th>Calls</th><th>Path read</th><th>What is read</th><th /></tr></thead>
          <tbody>
            {snapshot.providers.map(p => (
              <tr key={p.slug} className={p.available ? "" : "dim"}>
                <td className="name">{p.name}</td>
                <td><span className={`pill ${p.available ? "ok" : "off"}`}>{p.available ? "available" : "not found"}</span>{p.overridden && <span className="pill note" title="Path overridden in Settings">override</span>}</td>
                <td className="num">{p.calls.toLocaleString()}</td>
                <td className="mono paths" title={p.path}>{p.path}</td>
                <td className="muted small">{READS[p.slug]}</td>
                <td className="rowactions"><button className="link" onClick={() => void reveal(p.path)} disabled={!p.available}>reveal</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
