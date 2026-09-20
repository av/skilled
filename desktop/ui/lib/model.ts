/** Desktop view-model helpers. Pure; tested in tests/unit/model.test.ts. */
import type { SkillCall, SkillCount } from "../../../src/models";
import type { SkillAudit, SkillDetail } from "../../../src/data";
import { skillCounts, hourlyCounts, auditSkills, projectShort } from "../../../src/data";
import { buildHeatmapGrid, filterCalls, type HeatmapGrid } from "../../../src/view";
import type { DesktopCall, ProviderInfo, Settings } from "./bridge";

export type View = "dashboard" | "activity" | "audit" | "providers" | "settings";
export const VIEWS: { id: View; label: string; key: string }[] = [
  { id: "dashboard", label: "Dashboard", key: "1" },
  { id: "activity", label: "Activity", key: "2" },
  { id: "audit", label: "Audit", key: "3" },
  { id: "providers", label: "Providers", key: "4" },
  { id: "settings", label: "Settings", key: "5" },
];

// --- noise filters -----------------------------------------------------------

const norm = (xs: string[]) => xs.map(x => x.trim().toLowerCase()).filter(Boolean);

/** Hide calls matching the user's noise settings (substring, case-insensitive). */
export function applyNoise<T extends SkillCall>(calls: T[], settings: Pick<Settings, "noiseSkills" | "noiseProjects" | "noiseSources">): T[] {
  const skills = norm(settings.noiseSkills);
  const projects = norm(settings.noiseProjects);
  const sources = norm(settings.noiseSources);
  if (!skills.length && !projects.length && !sources.length) return calls;
  return calls.filter(c => {
    const skill = c.skill.toLowerCase();
    if (skills.some(s => skill.includes(s))) return false;
    const project = c.project.toLowerCase();
    if (projects.some(p => project.includes(p))) return false;
    const source = c.source.toLowerCase();
    if (sources.some(s => source.includes(s))) return false;
    return true;
  });
}

// --- derived state -----------------------------------------------------------

export interface Derived {
  filtered: DesktopCall[];
  skills: SkillCount[];
  hourly: number[];
  heat: HeatmapGrid;
  audit: SkillAudit;
  uniqueProjects: number;
  uniqueSources: number;
  sourceOptions: string[];
  projectOptions: { path: string; short: string; count: number }[];
}

/** One pass over the calls: everything the dashboard/audit need. */
export function derive(all: DesktopCall[], filterExpr: string, now = new Date()): Derived {
  const filtered = filterCalls(all, filterExpr) as DesktopCall[];
  const skills = skillCounts(filtered);
  const sources = new Set<string>();
  const projects = new Map<string, number>();
  for (const c of all) sources.add(c.source);
  for (const c of filtered) projects.set(c.project, (projects.get(c.project) ?? 0) + 1);
  const projectOptions = [...projects.entries()]
    .map(([path, count]) => ({ path, short: projectShort(path), count }))
    .sort((a, b) => b.count - a.count || a.short.localeCompare(b.short));
  return {
    filtered,
    skills,
    hourly: hourlyCounts(filtered),
    heat: buildHeatmapGrid(filtered, now),
    audit: auditSkills(filtered, skills),
    uniqueProjects: projects.size,
    uniqueSources: new Set(filtered.map(c => c.source)).size,
    sourceOptions: [...sources].sort(),
    projectOptions,
  };
}

/** Add/replace a `tag:value` token in a filter expression without touching the rest. */
export function setFilterTag(expr: string, tag: "s" | "p", value: string): string {
  const re = tag === "s" ? /^(source|src|s):/i : /^(project|proj|p):/i;
  const rest = expr.trim().split(/\s+/).filter(t => t && !re.test(t));
  if (value) rest.push(`${tag}:${value.toLowerCase().replace(/\s+/g, "-")}`);
  return rest.join(" ");
}

// --- keyboard ----------------------------------------------------------------

export type Action =
  | { type: "sort-cycle" } | { type: "sort-toggle" }
  | { type: "move"; by: number } | { type: "move-to"; to: "top" | "bottom" } | { type: "page"; dir: 1 | -1 }
  | { type: "detail-toggle" } | { type: "audit-toggle" } | { type: "filter-focus" } | { type: "refresh" }
  | { type: "escape" } | { type: "quit" } | { type: "view"; view: View } | { type: "export" };

export interface KeyLike { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; inInput: boolean }

/** Map a keydown to an action. Mirrors the TUI key table in README. */
export function keymap(e: KeyLike): Action | null {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.altKey) {
    const view = VIEWS.find(v => v.key === e.key);
    if (view) return { type: "view", view: view.id };
    if (e.key === "r" || e.key === "R") return { type: "refresh" };
    if (e.key === "f" || e.key === "F") return { type: "filter-focus" };
    if (e.key === "e" || e.key === "E") return { type: "export" };
    if (e.key === "q" || e.key === "Q") return { type: "quit" };
  }
  if (e.inInput) {
    if (e.key === "Escape") return { type: "escape" };
    return null;
  }
  if (e.ctrlKey && e.key === "d") return { type: "page", dir: 1 };
  if (e.ctrlKey && e.key === "u") return { type: "page", dir: -1 };
  if (mod || e.altKey) return null;
  switch (e.key) {
    case "s": return { type: "sort-cycle" };
    case "Tab": return { type: "sort-toggle" };
    case "j": case "ArrowDown": return { type: "move", by: 1 };
    case "k": case "ArrowUp": return { type: "move", by: -1 };
    case "g": return { type: "move-to", to: "top" };
    case "G": return { type: "move-to", to: "bottom" };
    case "PageDown": return { type: "page", dir: 1 };
    case "PageUp": return { type: "page", dir: -1 };
    case "Enter": return { type: "detail-toggle" };
    case "a": return { type: "audit-toggle" };
    case "/": case "f": return { type: "filter-focus" };
    case "r": return { type: "refresh" };
    case "Escape": return { type: "escape" };
    case "q": return { type: "quit" };
  }
  return null;
}

// --- export ------------------------------------------------------------------

export function csvEscape(v: unknown): string {
  const s = v instanceof Date ? v.toISOString() : String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0) return (columns ?? []).join(",") + "\n";
  const cols = columns ?? Object.keys(rows[0]!);
  const lines = [cols.join(",")];
  for (const r of rows) lines.push(cols.map(c => csvEscape(r[c])).join(","));
  return lines.join("\n") + "\n";
}

export function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

/** Flatten each view's data to rows; JSON keeps the structured form. Field names match the CLI's --json output. */
export const exporters = {
  skills: (skills: SkillCount[]) => skills.map(s => ({ skill: s.skill, count: s.count, projects: s.projects, sessions: s.sessions, lastUsed: s.lastUsed.toISOString() })),
  calls: (calls: DesktopCall[]) => calls.map(c => ({ skill: c.skill, timestamp: c.timestamp.toISOString(), project: c.project, sessionId: c.sessionId, source: c.source, file: c.file })),
  detail: (d: SkillDetail) => ({ ...d, firstUsed: d.firstUsed.toISOString(), lastUsed: d.lastUsed.toISOString() }),
  detailRows: (d: SkillDetail) => d.projects.map(p => ({ skill: d.skill, project: p.name, count: p.count })),
  audit: (a: SkillAudit) => ({
    mostUsed: a.mostUsed.map(m => ({ skill: m.skill.skill, share: m.share, count: m.skill.count, projects: m.skill.projects })),
    rising: a.rising.map(t => ({ skill: t.skill.skill, recentCount: t.recentCount, priorCount: t.priorCount, pct: t.pct })),
    declining: a.declining.map(t => ({ skill: t.skill.skill, recentCount: t.recentCount, priorCount: t.priorCount, pct: t.pct })),
    stale: a.stale.map(s => ({ skill: s.skill, lastUsed: s.lastUsed.toISOString(), count: s.count })),
    crossProject: a.crossProject.map(s => ({ skill: s.skill, projects: s.projects, count: s.count })),
    oneOff: a.oneOff.map(s => ({ skill: s.skill, lastUsed: s.lastUsed.toISOString() })),
    singleProject: a.singleProject.map(s => ({ skill: s.skill, count: s.count })),
  }),
  auditRows: (a: SkillAudit) => {
    const rows: { section: string; skill: string; detail: string }[] = [];
    for (const m of a.mostUsed) rows.push({ section: "mostUsed", skill: m.skill.skill, detail: `${Math.round(m.share * 100)}%` });
    for (const t of a.rising) rows.push({ section: "rising", skill: t.skill.skill, detail: `+${t.pct}%` });
    for (const t of a.declining) rows.push({ section: "declining", skill: t.skill.skill, detail: `-${t.pct}%` });
    for (const s of a.stale) rows.push({ section: "stale", skill: s.skill, detail: s.lastUsed.toISOString() });
    for (const s of a.crossProject) rows.push({ section: "crossProject", skill: s.skill, detail: `${s.projects} projects` });
    for (const s of a.oneOff) rows.push({ section: "oneOff", skill: s.skill, detail: s.lastUsed.toISOString() });
    for (const s of a.singleProject) rows.push({ section: "singleProject", skill: s.skill, detail: `${s.count} calls` });
    return rows;
  },
  providers: (p: ProviderInfo[]) => p.map(x => ({ name: x.name, available: x.available, calls: x.calls, path: x.path, overridden: x.overridden })),
};

// --- formatting --------------------------------------------------------------

export function fmtDateTime(d: Date): string {
  return Number.isFinite(d.getTime()) ? d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "unknown";
}

export function fmtPct(x: number): string {
  return `${Math.round(x * 100)}%`;
}
