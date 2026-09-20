import { useEffect, useRef } from "react";
import type { SkillCount } from "../../../src/models";
import { projectShort, timeAgo } from "../../../src/data";
import { HEATMAP_WEEKS, heatLevel, localDateStr } from "../../../src/view";
import type { Derived } from "../lib/model";
import type { DesktopCall } from "../lib/bridge";

interface Props { derived: Derived; skills: SkillCount[]; selected: number; onSelect: (i: number) => void; onOpen: (i: number) => void; now: Date; sortLabel?: string }

/** src/theme.ts barPalette: one colour per ranked row, cycling. */
export const BAR_PALETTE = ["#50AE90", "#C49058", "#8EBE6E", "#D48E6E", "#5EB8B0", "#C4A850", "#78AE78", "#C88880", "#50A0A8", "#D4A870", "#8AAE58", "#B07868", "#68B898", "#A89050"];
const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const BAR_STAGGER_MS = 70; // src/app.ts barStagger

export function Dashboard({ derived, skills, selected, onSelect, onOpen, now, sortLabel }: Props) {
  const total = derived.filtered.length;
  return (
    <div className="dashboard">
      <div className="stats" aria-label="Totals">
        <Stat kind="calls" icon="⚡" label={total === 1 ? "CALL" : "CALLS"} value={total} />
        <Stat kind="skills" icon="◆" label={derived.skills.length === 1 ? "SKILL" : "SKILLS"} value={derived.skills.length} />
        <Stat kind="projects" icon="▪" label={derived.uniqueProjects === 1 ? "PROJECT" : "PROJECTS"} value={derived.uniqueProjects} />
        <Stat kind="sources" icon="●" label={derived.uniqueSources === 1 ? "SOURCE" : "SOURCES"} value={derived.uniqueSources} />
      </div>
      <div className="columns">
        <SkillBars skills={skills} selected={selected} onSelect={onSelect} onOpen={onOpen} sortLabel={sortLabel} />
        <div className="right">
          <Heatmap derived={derived} now={now} />
          <Hourly hourly={derived.hourly} />
          <Recent calls={derived.filtered} skills={skills} />
        </div>
      </div>
    </div>
  );
}

function Stat({ kind, icon, label, value }: { kind: string; icon: string; label: string; value: number }) {
  return (
    <div className={`stat ${kind}`}>
      <span className="icon" aria-hidden>{icon}</span>
      <span className="value">{value.toLocaleString()}</span>
      <span className="label">{label}</span>
    </div>
  );
}

export function SkillBars({ skills, selected, onSelect, onOpen, compact = false, sortLabel }: { skills: SkillCount[]; selected: number; onSelect: (i: number) => void; onOpen: (i: number) => void; compact?: boolean; sortLabel?: string }) {
  const max = Math.max(1, ...skills.map(s => s.count));
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = list.current?.children[selected] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  return (
    <section className={compact ? "panel bars compact" : "panel bars"} aria-label="Skill frequency">
      <h2><span className="glyph">◆</span> skill frequency <span className="muted">{skills.length} skills</span></h2>
      {skills.length === 0 ? <div className="empty">No skills match the current filter.<br />Press <kbd>/</kbd> to edit the filter, <kbd>Esc</kbd> to clear.</div> : (
        <ol ref={list} className="barlist" role="listbox" aria-activedescendant={`skill-${selected}`}>
          {skills.map((s, i) => (
            <li key={s.skill} id={`skill-${i}`} role="option" aria-selected={i === selected} className={i === selected ? "bar selected" : "bar"} style={{ "--c": BAR_PALETTE[i % BAR_PALETTE.length] } as React.CSSProperties} onClick={() => onSelect(i)} onDoubleClick={() => onOpen(i)} title={`${s.skill}: ${s.count} calls, ${s.projects} projects, ${s.sessions} sessions, last ${timeAgo(s.lastUsed)} ago (double-click or Enter for detail)`}>
              <span className="cursor" aria-hidden>▸</span>
              <span className="name">{s.skill}</span>
              <span className="track"><span className="fill" style={{ width: `${(s.count / max) * 100}%`, animationDelay: `${Math.min(i, 40) * BAR_STAGGER_MS}ms` }} /></span>
              <span className="count">{s.count}</span>
              {!compact && <span className="meta">{s.projects}p · {s.sessions}s · {timeAgo(s.lastUsed)}</span>}
            </li>
          ))}
        </ol>
      )}
      {sortLabel && <span className="btitle"><span className="glyph">◇</span> {sortLabel}</span>}
    </section>
  );
}

function Heatmap({ derived, now }: { derived: Derived; now: Date }) {
  const { grid, maxVal, startDate } = derived.heat;
  return (
    <section className="panel heatmap" aria-label="Activity map">
      <h2><span className="glyph">▣</span> activity map <span className="muted">{HEATMAP_WEEKS} weeks</span></h2>
      <div className="heat-grid" style={{ gridTemplateColumns: `auto repeat(${HEATMAP_WEEKS}, 1fr)` }}>
        {DAYS.map((d, r) => <span key={`l${r}`} className="heat-label" style={{ gridRow: r + 1, gridColumn: 1 }}>{d}</span>)}
        {grid.map((week, w) => week.map((v, d) => {
          const date = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + w * 7 + d);
          const future = date > now;
          return <span key={`${w}-${d}`} className={`heat-cell l${heatLevel(v, maxVal)}${future ? " future" : ""}`} style={{ gridRow: d + 1, gridColumn: w + 2, animationDelay: `${(w * 7 + d) * 12}ms` }} title={`${localDateStr(date)}: ${v} call${v === 1 ? "" : "s"}`} />;
        }))}
      </div>
    </section>
  );
}

function Hourly({ hourly }: { hourly: number[] }) {
  const max = Math.max(1, ...hourly);
  return (
    <section className="panel hourly" aria-label="Time of day">
      <h2><span className="glyph">◑</span> time of day</h2>
      <div className="hour-bars">
        {hourly.map((v, h) => <span key={h} className={`hour l${Math.min(4, Math.round((v / max) * 4))}`} style={{ animationDelay: `${h * 25}ms` }} title={`${String(h).padStart(2, "0")}:00 — ${v} calls`}><span className="fill" /></span>)}
      </div>
      <div className="hour-axis"><span>0</span><span>6</span><span>12</span><span>18</span></div>
    </section>
  );
}

function Recent({ calls, skills }: { calls: DesktopCall[]; skills: SkillCount[] }) {
  const colorOf = (skill: string) => { const i = skills.findIndex(s => s.skill === skill); return BAR_PALETTE[(i >= 0 ? i : 0) % BAR_PALETTE.length]; };
  return (
    <section className="panel recent" aria-label="Recent">
      <h2><span className="glyph">●</span> recent</h2>
      <ul>
        {calls.slice(0, 20).map((c, i) => (
          <li key={`${c.sessionId}-${c.timestamp.getTime()}-${i}`} style={{ "--c": colorOf(c.skill) } as React.CSSProperties} title={`${c.timestamp.toLocaleString()} · ${c.project} · ${c.source}`}>
            <span className="dot" aria-hidden>●</span>
            <span className="skill">{c.skill}</span>
            <span className="proj">{projectShort(c.project)}</span>
            <span className="src">{c.source}</span>
            <span className="when">{timeAgo(c.timestamp)}</span>
          </li>
        ))}
        {calls.length === 0 && <li className="muted">No activity.</li>}
      </ul>
    </section>
  );
}
