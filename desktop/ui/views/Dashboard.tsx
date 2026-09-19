import { useEffect, useRef } from "react";
import type { SkillCount } from "../../../src/models";
import { projectShort, timeAgo } from "../../../src/data";
import { HEATMAP_WEEKS, heatLevel, localDateStr } from "../../../src/view";
import type { Derived } from "../lib/model";
import type { DesktopCall } from "../lib/bridge";

interface Props { derived: Derived; skills: SkillCount[]; selected: number; onSelect: (i: number) => void; onOpen: (i: number) => void; now: Date }

const BAR_PALETTE = ["#50AE90", "#C49058", "#8EBE6E", "#D48E6E", "#5EB8B0", "#C4A850", "#78AE78", "#C88880", "#50A0A8", "#D4A870", "#8AAE58", "#B07868", "#68B898", "#A89050"];

export function Dashboard({ derived, skills, selected, onSelect, onOpen, now }: Props) {
  const total = derived.filtered.length;
  return (
    <div className="dashboard">
      <section className="stats" aria-label="Totals">
        <Stat icon="⚡" label={total === 1 ? "CALL" : "CALLS"} value={total} color="#50AE90" />
        <Stat icon="◆" label="SKILLS" value={derived.skills.length} color="#C49058" />
        <Stat icon="▣" label="PROJECTS" value={derived.uniqueProjects} color="#5EB8B0" />
        <Stat icon="⌁" label="SOURCES" value={derived.uniqueSources} color="#C4A850" />
      </section>
      <div className="columns">
        <SkillBars skills={skills} selected={selected} onSelect={onSelect} onOpen={onOpen} />
        <div className="right">
          <Heatmap derived={derived} now={now} />
          <Hourly hourly={derived.hourly} />
          <Recent calls={derived.filtered} />
        </div>
      </div>
    </div>
  );
}

function Stat({ icon, label, value, color }: { icon: string; label: string; value: number; color: string }) {
  return (
    <div className="stat" style={{ "--accent": color } as React.CSSProperties}>
      <span className="icon" aria-hidden>{icon}</span>
      <span className="value">{value.toLocaleString()}</span>
      <span className="label">{label}</span>
    </div>
  );
}

export function SkillBars({ skills, selected, onSelect, onOpen, compact = false }: { skills: SkillCount[]; selected: number; onSelect: (i: number) => void; onOpen: (i: number) => void; compact?: boolean }) {
  const max = Math.max(1, ...skills.map(s => s.count));
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = list.current?.children[selected] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  return (
    <section className={compact ? "panel bars compact" : "panel bars"} aria-label="Skill usage">
      <h2>◆ skill usage <span className="muted">{skills.length} skills</span></h2>
      {skills.length === 0 ? <div className="empty">No skills match the current filter.<br /><span className="muted">Press <kbd>/</kbd> to edit the filter, <kbd>Esc</kbd> to clear.</span></div> : (
        <ol ref={list} className="barlist" role="listbox" aria-activedescendant={`skill-${selected}`}>
          {skills.map((s, i) => (
            <li key={s.skill} id={`skill-${i}`} role="option" aria-selected={i === selected} className={i === selected ? "bar selected" : "bar"} onClick={() => onSelect(i)} onDoubleClick={() => onOpen(i)} title={`${s.skill}: ${s.count} calls, ${s.projects} projects, ${s.sessions} sessions, last ${timeAgo(s.lastUsed)} ago (double-click or Enter for detail)`}>
              <span className="name">{s.skill}</span>
              <span className="track"><span className="fill" style={{ width: `${(s.count / max) * 100}%`, background: BAR_PALETTE[i % BAR_PALETTE.length], animationDelay: `${Math.min(i, 30) * 25}ms` }} /></span>
              <span className="count">{s.count}</span>
              {!compact && <span className="meta">{s.projects}p · {s.sessions}s · {timeAgo(s.lastUsed)}</span>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Heatmap({ derived, now }: { derived: Derived; now: Date }) {
  const { grid, maxVal, startDate } = derived.heat;
  const days = ["Mon", "", "Wed", "", "Fri", "", "Sun"];
  return (
    <section className="panel heatmap" aria-label="Activity heatmap">
      <h2>▦ activity <span className="muted">last {HEATMAP_WEEKS} weeks</span></h2>
      <div className="heat-grid" style={{ gridTemplateColumns: `auto repeat(${HEATMAP_WEEKS}, 1fr)` }}>
        {days.map((d, r) => <span key={`l${r}`} className="heat-label" style={{ gridRow: r + 1, gridColumn: 1 }}>{d}</span>)}
        {grid.map((week, w) => week.map((v, d) => {
          const date = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + w * 7 + d);
          const future = date > now;
          return <span key={`${w}-${d}`} className={`heat-cell l${heatLevel(v, maxVal)}${future ? " future" : ""}`} style={{ gridRow: d + 1, gridColumn: w + 2, animationDelay: `${w * 20}ms` }} title={`${localDateStr(date)}: ${v} call${v === 1 ? "" : "s"}`} />;
        }))}
      </div>
    </section>
  );
}

function Hourly({ hourly }: { hourly: number[] }) {
  const max = Math.max(1, ...hourly);
  return (
    <section className="panel hourly" aria-label="Time of day">
      <h2>◷ time of day</h2>
      <div className="hour-bars">
        {hourly.map((v, h) => <span key={h} className="hour" title={`${String(h).padStart(2, "0")}:00 — ${v} calls`}><span className="fill" style={{ height: `${(v / max) * 100}%`, animationDelay: `${h * 15}ms` }} /></span>)}
      </div>
      <div className="hour-axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
    </section>
  );
}

function Recent({ calls }: { calls: DesktopCall[] }) {
  return (
    <section className="panel recent" aria-label="Recent activity">
      <h2>≡ recent activity</h2>
      <ul>
        {calls.slice(0, 20).map((c, i) => (
          <li key={`${c.sessionId}-${c.timestamp.getTime()}-${i}`} title={`${c.timestamp.toLocaleString()} · ${c.project}`}>
            <span className="when">{timeAgo(c.timestamp)}</span>
            <span className="skill">{c.skill}</span>
            <span className="muted">{projectShort(c.project)}</span>
            <span className="src">{c.source}</span>
          </li>
        ))}
        {calls.length === 0 && <li className="muted">No activity.</li>}
      </ul>
    </section>
  );
}
