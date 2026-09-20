import type { SkillAudit } from "../../../src/data";
import { timeAgo } from "../../../src/data";
import { fmtPct } from "../lib/model";

interface Props { audit: SkillAudit; onOpenSkill: (skill: string) => void }

/** Same seven sections, order and thresholds as `buildAuditLines()` in the TUI and `cmdAudit` in the CLI. */
export function Audit({ audit, onOpenSkill }: Props) {
  const total = audit.mostUsed.length + audit.rising.length + audit.declining.length + audit.stale.length + audit.crossProject.length + audit.oneOff.length + audit.singleProject.length;
  return (
    <div className="audit">
      <header className="panel-header"><h2>Skill audit <span className="muted">{total} findings</span></h2></header>
      {total === 0 && <div className="empty">Not enough history for an audit yet.</div>}
      <div className="audit-grid">
        <Section tone="accent" title="Most used" sub="last 4 weeks" items={audit.mostUsed.map(h => ({ skill: h.skill.skill, detail: `${fmtPct(h.share)} · ${h.skill.count} calls · ${h.skill.projects} proj` }))} onOpen={onOpenSkill} />
        <Section tone="success" title="Rising" sub="50%+ growth last 4w" items={audit.rising.map(r => ({ skill: r.skill.skill, detail: `+${r.pct}% · ${r.priorCount} → ${r.recentCount}` }))} onOpen={onOpenSkill} />
        <Section tone="danger" title="Declining" sub="50%+ drop last 4w" items={audit.declining.map(d => ({ skill: d.skill.skill, detail: `-${d.pct}% · ${d.priorCount} → ${d.recentCount}` }))} onOpen={onOpenSkill} />
        <Section tone="warn" title="Stale" sub="unused 28+ days" items={audit.stale.map(s => ({ skill: s.skill, detail: `last ${timeAgo(s.lastUsed)} ago · ${s.count} calls` }))} onOpen={onOpenSkill} />
        <Section tone="info" title="Cross-project" sub="used in 3+ projects" items={audit.crossProject.map(s => ({ skill: s.skill, detail: `${s.projects} projects · ${s.count} calls` }))} onOpen={onOpenSkill} />
        <Section tone="info" title="One-off" sub="used once" items={audit.oneOff.map(s => ({ skill: s.skill, detail: `${timeAgo(s.lastUsed)} ago` }))} onOpen={onOpenSkill} />
        <Section tone="accent" title="Single-project" sub="1 project only" items={audit.singleProject.map(s => ({ skill: s.skill, detail: `${s.count} calls` }))} onOpen={onOpenSkill} />
      </div>
    </div>
  );
}

function Section({ tone, title, sub, items, onOpen }: { tone: string; title: string; sub: string; items: { skill: string; detail: string }[]; onOpen: (s: string) => void }) {
  return (
    <section className={`audit-section ${tone}`} aria-label={title}>
      <h3><span className="dot" aria-hidden />{title} <span className="muted">{sub}</span><span className="badge">{items.length}</span></h3>
      {items.length === 0 ? <div className="muted none">None</div> : (
        <ul>{items.map(i => <li key={i.skill}><button className="link skill" onClick={() => onOpen(i.skill)} title="Open detail">{i.skill}</button><span className="muted detail">{i.detail}</span></li>)}</ul>
      )}
    </section>
  );
}
