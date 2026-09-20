import { useEffect, useRef } from "react";
import { SORT_LABELS, tokenizeFilterExpr, type SortMode } from "../../../src/view";
import { setFilterTag } from "../lib/model";

interface Props {
  expr: string; onChange: (v: string) => void; focusToken: number;
  sources: string[]; projects: { path: string; short: string; count: number }[];
  sortMode: SortMode; sortAsc: boolean; onSortCycle: () => void; onSortToggle: () => void;
}

export function FilterBar({ expr, onChange, focusToken, sources, projects, sortMode, sortAsc, onSortCycle, onSortToggle }: Props) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (focusToken > 0) { input.current?.focus(); input.current?.select(); } }, [focusToken]);
  const tokens = tokenizeFilterExpr(expr);
  const activeSource = tokens.find((t, i) => t.kind === "tag" && /^s(rc|ource)?:/i.test(t.text) && tokens[i + 1])?.text;
  const sourceValue = activeSource ? tokens[tokens.indexOf(tokens.find(t => t.text === activeSource)!) + 1]?.text ?? "" : "";
  const projectTag = tokens.findIndex(t => t.kind === "tag" && /^p(roj|roject)?:/i.test(t.text));
  const projectValue = projectTag >= 0 ? tokens[projectTag + 1]?.text ?? "" : "";

  return (
    <div className="filterbar" role="search">
      <label className="filter-input">
        <span className="slash" aria-hidden>/</span>
        <div className="ghost" aria-hidden>{tokens.map((t, i) => <span key={i} className={`tok ${t.kind}`}>{t.text}</span>)}</div>
        <input ref={input} value={expr} onChange={e => onChange(e.target.value)} placeholder="filter · s: source  p: project  bare text matches skill name" spellCheck={false} aria-label="Filter skills (source:, project:, skill name)" />
        {expr && <button className="clear" onClick={() => onChange("")} aria-label="Clear filter">×</button>}
      </label>
      <select value={sourceValue} onChange={e => onChange(setFilterTag(expr, "s", e.target.value))} aria-label="Source">
        <option value="">all sources</option>
        {sources.map(s => <option key={s} value={s.toLowerCase().replace(/\s+/g, "-")}>{s}</option>)}
      </select>
      <select value={projectValue} onChange={e => onChange(setFilterTag(expr, "p", e.target.value))} aria-label="Project">
        <option value="">all projects</option>
        {projects.map(p => <option key={p.path} value={p.short.toLowerCase()} title={p.path}>{p.short} ({p.count})</option>)}
      </select>
      <div className="sort">
        <button className="btn" onClick={onSortCycle} title="Cycle sort (s)">{SORT_LABELS[sortMode]}</button>
        <button className="btn" onClick={onSortToggle} title="Toggle direction (Tab)" aria-label={sortAsc ? "ascending" : "descending"}>{sortAsc ? "▲" : "▼"}</button>
      </div>
    </div>
  );
}
