/**
 * View-model logic shared by the TUI (app.ts) and the desktop app.
 * Pure functions only: no rendering, no I/O.
 */
import type { SkillCall, SkillCount } from "./models.js";
import { projectShort } from "./data.js";

export const HEATMAP_WEEKS = 16;

// --- sorting -----------------------------------------------------------------

export type SortMode = "count" | "alpha" | "recent";
export const SORT_LABELS: Record<SortMode, string> = {
  count: "by count",
  alpha: "a-z",
  recent: "by recent",
};
export const SORT_CYCLE: SortMode[] = ["count", "alpha", "recent"];
export const SORT_DEFAULT_ASC: Record<SortMode, boolean> = {
  count: false,
  alpha: true,
  recent: false,
};

export function nextSortMode(mode: SortMode): SortMode {
  const idx = SORT_CYCLE.indexOf(mode);
  return SORT_CYCLE[(idx + 1) % SORT_CYCLE.length]!;
}

export function sortSkills(skills: SkillCount[], mode: SortMode, asc: boolean): SkillCount[] {
  const copy = [...skills];
  switch (mode) {
    case "count":
      return copy.sort((a, b) => asc ? a.count - b.count : b.count - a.count);
    case "alpha":
      return copy.sort((a, b) => asc ? a.skill.localeCompare(b.skill) : b.skill.localeCompare(a.skill));
    case "recent":
      return copy.sort((a, b) => asc ? a.lastUsed.getTime() - b.lastUsed.getTime() : b.lastUsed.getTime() - a.lastUsed.getTime());
  }
}

// --- filtering ---------------------------------------------------------------

export interface FilterCriteria {
  sources: string[];
  projects: string[];
  skills: string[];
}

const FILTER_TAG = /^(source|src|s|project|proj|p):(.+)$/i;

/** Parse the TUI filter expression: `source:codex p:myapp review`. */
export function parseFilterExpr(expr: string): FilterCriteria {
  const sources: string[] = [];
  const projects: string[] = [];
  const skills: string[] = [];
  for (const token of expr.trim().split(/\s+/)) {
    if (!token) continue;
    const m = token.match(FILTER_TAG);
    if (m) {
      const tag = m[1]!.toLowerCase();
      const val = m[2]!.toLowerCase();
      if (tag === "s" || tag === "src" || tag === "source") sources.push(val);
      else projects.push(val);
    } else {
      skills.push(token.toLowerCase());
    }
  }
  return { sources, projects, skills };
}

/** Apply parsed criteria exactly the way the TUI does (substring, case-insensitive). */
export function applyFilter(calls: SkillCall[], criteria: FilterCriteria): SkillCall[] {
  const { sources, projects, skills } = criteria;
  let result = calls;
  if (sources.length) result = result.filter(c => sources.some(s => c.source.toLowerCase().includes(s)));
  if (projects.length) result = result.filter(c => projects.some(p => projectShort(c.project).toLowerCase().includes(p)));
  if (skills.length) result = result.filter(c => skills.some(s => c.skill.toLowerCase().includes(s)));
  return result;
}

export function filterCalls(calls: SkillCall[], expr: string): SkillCall[] {
  return applyFilter(calls, parseFilterExpr(expr));
}

/** Token kinds for syntax-highlighting a filter expression. */
export type FilterToken = { text: string; kind: "tag" | "value" | "skill" | "space" };

export function tokenizeFilterExpr(expr: string): FilterToken[] {
  const out: FilterToken[] = [];
  let pos = 0;
  while (pos < expr.length) {
    if (expr[pos] === " ") {
      let end = pos;
      while (end < expr.length && expr[end] === " ") end++;
      out.push({ text: expr.slice(pos, end), kind: "space" });
      pos = end;
      continue;
    }
    let end = pos;
    while (end < expr.length && expr[end] !== " ") end++;
    const token = expr.slice(pos, end);
    const m = token.match(FILTER_TAG);
    if (m) {
      const tagLen = m[1]!.length + 1;
      out.push({ text: token.slice(0, tagLen), kind: "tag" });
      out.push({ text: token.slice(tagLen), kind: "value" });
    } else {
      out.push({ text: token, kind: "skill" });
    }
    pos = end;
  }
  return out;
}

// --- heatmap -----------------------------------------------------------------

/** Format a Date as YYYY-MM-DD in local time. */
export function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export interface HeatmapGrid {
  /** grid[week][dayOfWeek], Monday = 0, oldest week first. */
  grid: number[][];
  maxVal: number;
  /** Local-midnight date of grid[0][0]. */
  startDate: Date;
}

export function buildHeatmapGrid(calls: SkillCall[], now: Date = new Date()): HeatmapGrid {
  // Use local day-of-week (getDay) so the heatmap aligns with the user's
  // local calendar, consistent with hourlyCounts which uses getHours().
  const todayDow = (now.getDay() + 6) % 7; // Monday=0 … Sunday=6

  // Compute the start date using local-time date arithmetic to avoid DST bugs.
  // Subtracting fixed milliseconds from local midnight can land on the wrong
  // date when crossing a CET/CEST (or similar) boundary.
  const daysBack = (HEATMAP_WEEKS - 1) * 7 + todayDow;
  const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack);
  const baseYear = startDate.getFullYear();
  const baseMonth = startDate.getMonth();
  const baseDay = startDate.getDate();

  const dayCounts = new Map<string, number>();
  for (const c of calls) {
    const d = localDateStr(c.timestamp);
    dayCounts.set(d, (dayCounts.get(d) ?? 0) + 1);
  }

  let maxVal = 0;
  const grid: number[][] = [];
  // Iterate by constructing each day as a local midnight to avoid DST issues.
  for (let w = 0; w < HEATMAP_WEEKS; w++) {
    const col: number[] = [];
    for (let d = 0; d < 7; d++) {
      const dayOffset = w * 7 + d;
      const cellDate = new Date(baseYear, baseMonth, baseDay + dayOffset);
      const dateStr = localDateStr(cellDate);
      const v = dayCounts.get(dateStr) ?? 0;
      if (v > maxVal) maxVal = v;
      col.push(v);
    }
    grid.push(col);
  }
  return { grid, maxVal, startDate };
}

/** 0..4 intensity bucket used by both the TUI palette and the desktop CSS. */
export function heatLevel(value: number, maxVal: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0 || maxVal <= 0) return 0;
  return Math.min(4, Math.ceil((value / maxVal) * 4)) as 1 | 2 | 3 | 4;
}
