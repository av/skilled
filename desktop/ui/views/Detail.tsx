import type { SkillDetail } from "../../../src/data";
import type { SkillCount } from "../../../src/models";
import { timeAgo } from "../../../src/data";
import type { DesktopCall } from "../lib/bridge";
import { fmtDateTime } from "../lib/model";
import { SkillBars } from "./Dashboard";
import { CallRow } from "./Activity";

interface Props {
  detail: SkillDetail; calls: DesktopCall[]; onClose: () => void; onExport: (kind: "json" | "csv") => void;
  skills: SkillCount[]; selected: number; onSelect: (i: number) => void;
}

export function Detail({ detail: d, calls, onClose, onExport, skills, selected, onSelect }: Props) {
  const maxWeek = Math.max(1, ...d.weeklyUsage);
  const maxProj = Math.max(1, ...d.projects.map(p => p.count));
  return (
    <div className="columns detail-layout">
      <SkillBars skills={skills} selected={selected} onSelect={onSelect} onOpen={onSelect} compact />
      <section className="panel detail" aria-label={`Detail for ${d.skill}`}>
        <header>
          <h2>{d.skill}</h2>
          <div className="actions">
            <button className="btn" onClick={() => onExport("json")}>JSON</button>
            <button className="btn" onClick={() => onExport("csv")}>CSV</button>
            <button className="btn" onClick={onClose} title="Close (Esc)">Close</button>
          </div>
        </header>
        <div className="kv">
          <div><span className="k">Calls</span><span className="v">{d.count}</span></div>
          <div><span className="k">Sessions</span><span className="v">{d.sessions}</span></div>
          <div><span className="k">Projects</span><span className="v">{d.projects.length}</span></div>
          <div><span className="k">First used</span><span className="v" title={fmtDateTime(d.firstUsed)}>{timeAgo(d.firstUsed)} ago</span></div>
          <div><span className="k">Last used</span><span className="v" title={fmtDateTime(d.lastUsed)}>{timeAgo(d.lastUsed)} ago</span></div>
        </div>
        <h3>Weekly usage <span className="muted">16 weeks</span></h3>
        <div className="sparkline" role="img" aria-label={`Weekly usage: ${d.weeklyUsage.join(", ")}`}>
          {d.weeklyUsage.map((v, i) => <span key={i} className="bar" style={{ height: `${(v / maxWeek) * 100}%` }} title={`${15 - i} weeks ago: ${v}`} />)}
        </div>
        <h3>By project</h3>
        <ol className="projects">
          {d.projects.map(p => (
            <li key={p.name}><span className="name">{p.name}</span><span className="track"><span className="fill" style={{ width: `${(p.count / maxProj) * 100}%` }} /></span><span className="count">{p.count}</span></li>
          ))}
        </ol>
        <h3>Calls <span className="muted">{calls.length}</span></h3>
        <table className="calls">
          <thead><tr><th>When</th><th>Project</th><th>Session</th><th>Source</th><th /></tr></thead>
          <tbody>{calls.slice(0, 200).map((c, i) => <CallRow key={i} call={c} hideSkill />)}</tbody>
        </table>
      </section>
    </div>
  );
}
