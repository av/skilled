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
      <section className="panel index-status" aria-label="Reader">
        <h2><span className="glyph">⌁</span> reader</h2>
        <div className="kv wide">
          <div><span className="k">active reader</span><span className={`v reader ${snapshot.reader}`}>{snapshot.reader === "rustIndex" ? "rust index (in-process skilled-index)" : "typescript providers via `skilled --no-index`"}</span></div>
          <div><span className="k">last indexed</span><span className="v" title={fmtDateTime(indexed)}>{fmtDateTime(indexed)} <span className="muted">{snapshot.reindexed ? "re-parsed this refresh" : "fresh index reused"}</span></span></div>
          <div><span className="k">index file</span><span className="v">{snapshot.dbPath || "—"} {snapshot.dbPath && <button className="link" onClick={() => void reveal(snapshot.dbPath)}>reveal</button>}</span></div>
          <div><span className="k">versions</span><span className="v">index {snapshot.indexVersion ?? "—"} · app {info?.version ?? "?"} · {info?.platform}</span></div>
          <div><span className="k">scan time</span><span className="v">{snapshot.elapsedMs} ms</span></div>
          <div><span className="k">skilled cli</span><span className="v">{info?.cliAvailable ? "found on PATH (fallback available)" : "not installed (fallback unavailable)"}</span></div>
        </div>
        {snapshot.warnings.map((w, i) => <div key={i} className="warning">⚠ {w}</div>)}
        <p className="note">local files only · no network · no telemetry</p>
      </section>
      <section className="panel" aria-label="Providers">
        <h2><span className="glyph">▣</span> providers <span className="muted">{snapshot.providers.filter(p => p.available).length} of {snapshot.providers.length} detected</span></h2>
        <table className="providers-table">
          <thead><tr><th>tool</th><th>status</th><th>calls</th><th>path read</th><th>what is read</th><th /></tr></thead>
          <tbody>
            {snapshot.providers.map(p => (
              <tr key={p.slug} className={p.available ? "" : "dim"}>
                <td className="name">{p.name}</td>
                <td><span className={`pill ${p.available ? "ok" : "off"}`}>{p.available ? "available" : "not found"}</span>{p.overridden && <span className="pill note" title="Path overridden in Settings">override</span>}</td>
                <td className="num">{p.calls.toLocaleString()}</td>
                <td className="paths" title={p.path}>{p.path}</td>
                <td className="dim">{READS[p.slug]}</td>
                <td className="rowactions"><button className="link" onClick={() => void reveal(p.path)} disabled={!p.available}>reveal</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
