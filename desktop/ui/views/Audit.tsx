import type { SkillAudit } from "../../../src/data";
import { timeAgo } from "../../../src/data";
import { fmtPct } from "../lib/model";

interface Props { audit: SkillAudit; onOpenSkill: (skill: string) => void }

/** Same seven sections, order and thresholds as `buildAuditLines()` in the TUI and `cmdAudit` in the CLI. */
export function Audit({ audit, onOpenSkill }: Props) {
  const total = audit.mostUsed.length + audit.rising.length + audit.declining.length + audit.stale.length + audit.crossProject.length + audit.oneOff.length + audit.singleProject.length;
  return (
    <div className="audit">
      <header className="panel-header"><h2>▧ skill audit <span className="muted">{total} findings</span></h2></header>
      {total === 0 && <div className="empty">Not enough history for an audit yet.</div>}
      <div className="audit-grid">
        <Section icon="★" tone="purple" title="MOST USED" sub="last 4 weeks" items={audit.mostUsed.map(h => ({ skill: h.skill.skill, detail: `${fmtPct(h.share)} · ${h.skill.count} calls · ${h.skill.projects} proj` }))} onOpen={onOpenSkill} />
        <Section icon="▲" tone="success" title="RISING" sub="50%+ growth last 4w" items={audit.rising.map(r => ({ skill: r.skill.skill, detail: `+${r.pct}% · ${r.priorCount} → ${r.recentCount}` }))} onOpen={onOpenSkill} />
        <Section icon="▼" tone="danger" title="DECLINING" sub="50%+ drop last 4w" items={audit.declining.map(d => ({ skill: d.skill.skill, detail: `-${d.pct}% · ${d.priorCount} → ${d.recentCount}` }))} onOpen={onOpenSkill} />
        <Section icon="⚠" tone="warn" title="STALE" sub="unused 28+ days" items={audit.stale.map(s => ({ skill: s.skill, detail: `last ${timeAgo(s.lastUsed)} ago · ${s.count} calls` }))} onOpen={onOpenSkill} />
        <Section icon="◈" tone="info" title="CROSS-PROJECT" sub="used in 3+ projects" items={audit.crossProject.map(s => ({ skill: s.skill, detail: `${s.projects} projects · ${s.count} calls` }))} onOpen={onOpenSkill} />
        <Section icon="◇" tone="info" title="ONE-OFF" sub="used once" items={audit.oneOff.map(s => ({ skill: s.skill, detail: `${timeAgo(s.lastUsed)} ago` }))} onOpen={onOpenSkill} />
        <Section icon="▪" tone="pink" title="SINGLE-PROJECT" sub="1 project only" items={audit.singleProject.map(s => ({ skill: s.skill, detail: `${s.count} calls` }))} onOpen={onOpenSkill} />
      </div>
    </div>
  );
}

function Section({ icon, tone, title, sub, items, onOpen }: { icon: string; tone: string; title: string; sub: string; items: { skill: string; detail: string }[]; onOpen: (s: string) => void }) {
  return (
    <section className={`panel audit-section ${tone}`} aria-label={title}>
      <h3><span className="icon">{icon}</span> {title} <span className="muted">— {sub}</span><span className="badge">{items.length}</span></h3>
      {items.length === 0 ? <div className="muted none">none</div> : (
        <ul>{items.map(i => <li key={i.skill}><button className="link skill" onClick={() => onOpen(i.skill)} title="Open detail">{i.skill}</button><span className="muted detail">{i.detail}</span></li>)}</ul>
      )}
    </section>
  );
}
