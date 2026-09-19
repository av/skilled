import { useMemo, useState } from "react";
import { projectShort, timeAgo } from "../../../src/data";
import { backend, type DesktopCall } from "../lib/bridge";
import { fmtDateTime, setFilterTag } from "../lib/model";

interface Props {
  calls: DesktopCall[]; filterExpr: string; onFilter: (v: string) => void;
  sources: string[]; projects: { path: string; short: string; count: number }[]; onNotify: (m: string) => void;
}

type CallSort = "recent" | "name";
const PAGE = 200;

export function Activity({ calls, filterExpr, onFilter, sources, projects, onNotify }: Props) {
  const [sort, setSort] = useState<CallSort>("recent");
  const [limit, setLimit] = useState(PAGE);
  const sorted = useMemo(() => {
    const copy = [...calls];
    if (sort === "name") copy.sort((a, b) => a.skill.localeCompare(b.skill) || b.timestamp.getTime() - a.timestamp.getTime());
    else copy.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    return copy;
  }, [calls, sort]);
  const shown = sorted.slice(0, limit);
  return (
    <section className="panel activity" aria-label="Raw skill invocations">
      <header>
        <h2>≡ calls <span className="muted">{calls.length.toLocaleString()}</span></h2>
        <div className="actions">
          <input value={filterExpr} onChange={e => onFilter(e.target.value)} placeholder="filter: s:codex p:app review" aria-label="Filter" spellCheck={false} />
          <select onChange={e => onFilter(setFilterTag(filterExpr, "s", e.target.value))} defaultValue="" aria-label="Source"><option value="">all sources</option>{sources.map(s => <option key={s} value={s.toLowerCase().replace(/\s+/g, "-")}>{s}</option>)}</select>
          <select onChange={e => onFilter(setFilterTag(filterExpr, "p", e.target.value))} defaultValue="" aria-label="Project"><option value="">all projects</option>{projects.map(p => <option key={p.path} value={p.short.toLowerCase()}>{p.short}</option>)}</select>
          <select value={sort} onChange={e => setSort(e.target.value as CallSort)} aria-label="Sort"><option value="recent">by recent</option><option value="name">by skill</option></select>
        </div>
      </header>
      <table className="calls">
        <thead><tr><th>when</th><th>skill</th><th>project</th><th>session</th><th>source</th><th /></tr></thead>
        <tbody>{shown.map((c, i) => <CallRow key={i} call={c} onNotify={onNotify} />)}</tbody>
      </table>
      {sorted.length > limit && <button className="btn wide" onClick={() => setLimit(l => l + PAGE)}>Show {Math.min(PAGE, sorted.length - limit)} more of {(sorted.length - limit).toLocaleString()}</button>}
      {calls.length === 0 && <div className="empty">No calls match the current filter.</div>}
    </section>
  );
}

export function CallRow({ call: c, hideSkill = false, onNotify }: { call: DesktopCall; hideSkill?: boolean; onNotify?: (m: string) => void }) {
  const act = async (kind: "open" | "reveal") => {
    if (!c.file) { onNotify?.("This call has no source file recorded (TypeScript fallback reader)."); return; }
    const b = await backend();
    if (!(await b.pathExists(c.file))) { onNotify?.(`File no longer exists: ${c.file}`); return; }
    try { await (kind === "open" ? b.openPath(c.file) : b.revealPath(c.file)); }
    catch (e) { onNotify?.(`Could not ${kind}: ${String(e)}`); }
  };
  return (
    <tr>
      <td className="when" title={fmtDateTime(c.timestamp)}>{timeAgo(c.timestamp)}</td>
      {!hideSkill && <td className="skill">{c.skill}</td>}
      <td className="project" title={c.project}>{projectShort(c.project)}</td>
      <td className="session mono" title={c.sessionId}>{c.sessionId.slice(0, 12)}</td>
      <td className="src">{c.source}</td>
      <td className="rowactions">
        <button className="link" onClick={() => void act("open")} title={c.file ? `Open ${c.file}` : "No source file"} disabled={!c.file}>open</button>
        <button className="link" onClick={() => void act("reveal")} title={c.file ? `Reveal ${c.file}` : "No source file"} disabled={!c.file}>reveal</button>
      </td>
    </tr>
  );
}
