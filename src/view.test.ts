import { describe, expect, test } from "bun:test";
import type { SkillCall, SkillCount } from "./models.js";
import {
  HEATMAP_WEEKS, SORT_DEFAULT_ASC, nextSortMode, sortSkills, parseFilterExpr, applyFilter, filterCalls,
  tokenizeFilterExpr, buildHeatmapGrid, heatLevel, localDateStr,
} from "./view.js";

const call = (skill: string, source: string, project: string, ts: string): SkillCall =>
  ({ skill, source, project, sessionId: `${skill}-${ts}`, timestamp: new Date(ts) });

const calls: SkillCall[] = [
  call("review", "Claude Code", "/home/u/code/skilled", "2026-05-01T10:00:00"),
  call("commit", "Codex CLI", "/home/u/code/facts", "2026-05-02T11:00:00"),
  call("review", "Grok CLI", "/home/u/code/skilled", "2026-05-03T12:00:00"),
  call("bugbash", "OpenCode", "/home/u/code/other", "2026-05-03T13:00:00"),
];

describe("sortSkills", () => {
  const skills: SkillCount[] = [
    { skill: "b", count: 2, projects: 1, sessions: 1, lastUsed: new Date("2026-01-02") },
    { skill: "a", count: 5, projects: 1, sessions: 1, lastUsed: new Date("2026-01-01") },
    { skill: "c", count: 1, projects: 1, sessions: 1, lastUsed: new Date("2026-01-03") },
  ];
  test("count desc by default, asc when toggled", () => {
    expect(sortSkills(skills, "count", false).map(s => s.skill)).toEqual(["a", "b", "c"]);
    expect(sortSkills(skills, "count", true).map(s => s.skill)).toEqual(["c", "b", "a"]);
  });
  test("alpha and recent", () => {
    expect(sortSkills(skills, "alpha", true).map(s => s.skill)).toEqual(["a", "b", "c"]);
    expect(sortSkills(skills, "recent", false).map(s => s.skill)).toEqual(["c", "b", "a"]);
  });
  test("cycle order and default direction match the TUI", () => {
    expect(nextSortMode("count")).toBe("alpha");
    expect(nextSortMode("alpha")).toBe("recent");
    expect(nextSortMode("recent")).toBe("count");
    expect(SORT_DEFAULT_ASC).toEqual({ count: false, alpha: true, recent: false });
  });
  test("does not mutate input", () => {
    const copy = [...skills];
    sortSkills(skills, "alpha", true);
    expect(skills).toEqual(copy);
  });
});

describe("filter expression", () => {
  test("parses source/project tags and free text", () => {
    expect(parseFilterExpr("s:codex source:claude p:skilled project:Facts review")).toEqual({
      sources: ["codex", "claude"], projects: ["skilled", "facts"], skills: ["review"],
    });
    expect(parseFilterExpr("   ")).toEqual({ sources: [], projects: [], skills: [] });
  });
  test("applyFilter matches substrings case-insensitively on source, short project and skill", () => {
    expect(applyFilter(calls, parseFilterExpr("s:cli")).map(c => c.source)).toEqual(["Codex CLI", "Grok CLI"]);
    expect(filterCalls(calls, "p:skilled").length).toBe(2);
    expect(filterCalls(calls, "p:code").length).toBe(0); // project matched on basename only, like the TUI
    expect(filterCalls(calls, "rev").map(c => c.skill)).toEqual(["review", "review"]);
    expect(filterCalls(calls, "s:grok rev").length).toBe(1);
  });
  test("tokenizer highlights tags", () => {
    expect(tokenizeFilterExpr("s:codex  review")).toEqual([
      { text: "s:", kind: "tag" }, { text: "codex", kind: "value" },
      { text: "  ", kind: "space" }, { text: "review", kind: "skill" },
    ]);
  });
});

describe("heatmap", () => {
  test("grid is 16 weeks x 7 days ending on the current week", () => {
    const now = new Date(2026, 4, 6, 15); // Wed 6 May 2026
    const { grid, maxVal, startDate } = buildHeatmapGrid(calls, now);
    expect(grid.length).toBe(HEATMAP_WEEKS);
    expect(grid.every(w => w.length === 7)).toBe(true);
    expect(startDate.getDay()).toBe(1); // Monday
    expect(localDateStr(startDate)).toBe("2026-01-19");
    // Current week starts Mon 4 May; 2026-05-03 is the Sunday of the previous week: two calls that day
    expect(grid[14]![6]).toBe(2);
    expect(grid[14]![4]).toBe(1); // Fri 1 May
    expect(grid[15]!.every(v => v === 0)).toBe(true);
    expect(maxVal).toBe(2);
  });
  test("heatLevel buckets like the TUI (ceil of quarter)", () => {
    expect(heatLevel(0, 8)).toBe(0);
    expect(heatLevel(1, 8)).toBe(1);
    expect(heatLevel(2, 8)).toBe(1);
    expect(heatLevel(3, 8)).toBe(2);
    expect(heatLevel(8, 8)).toBe(4);
    expect(heatLevel(5, 0)).toBe(0);
  });
});
