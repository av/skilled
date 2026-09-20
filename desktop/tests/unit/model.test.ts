import { describe, expect, test } from "bun:test";
import { hydrate, type DesktopCall, type WireCall } from "../../ui/lib/bridge";
import { applyNoise, derive, setFilterTag, keymap, toCsv, csvEscape, exporters, toJson } from "../../ui/lib/model";
import { mockSnapshot } from "../../ui/lib/mock";
import { sortSkills } from "../../../src/view";
import { skillDetail } from "../../../src/data";

const wire = (skill: string, source: string, project: string, daysAgo: number, file = "/f"): WireCall =>
  ({ skill, source, project, sessionId: `${skill}-${daysAgo}`, timestampMs: Date.now() - daysAgo * 86400000, file });

const calls: DesktopCall[] = hydrate([
  wire("review", "Claude Code", "/home/u/code/skilled", 1),
  wire("commit", "Codex CLI", "/home/u/code/facts", 2),
  wire("review", "Grok CLI", "/home/u/code/skilled", 3),
  wire("test-noise", "OpenCode", "/home/u/code/scratch", 4),
]);

describe("data adapter", () => {
  test("hydrate keeps every field and converts timestamps", () => {
    expect(calls[0]!.timestamp).toBeInstanceOf(Date);
    expect(calls[0]!.file).toBe("/f");
    expect(calls[1]!.sessionId).toBe("commit-2");
  });
  test("noise filters hide by skill, project and source substrings", () => {
    expect(applyNoise(calls, { noiseSkills: ["NOISE"], noiseProjects: [], noiseSources: [] }).length).toBe(3);
    expect(applyNoise(calls, { noiseSkills: [], noiseProjects: ["scratch"], noiseSources: [] }).length).toBe(3);
    expect(applyNoise(calls, { noiseSkills: [], noiseProjects: [], noiseSources: ["grok"] }).length).toBe(3);
    expect(applyNoise(calls, { noiseSkills: [" "], noiseProjects: [], noiseSources: [] })).toBe(calls); // blank entries ignored
  });
});

describe("derive + filter", () => {
  test("derive aggregates with the TUI filter syntax", () => {
    const d = derive(calls, "s:cli");
    expect(d.filtered.length).toBe(2);
    expect(d.skills.map(s => s.skill)).toEqual(["commit", "review"]);
    expect(d.uniqueSources).toBe(2);
    expect(d.sourceOptions).toEqual(["Claude Code", "Codex CLI", "Grok CLI", "OpenCode"]);
    expect(d.heat.grid.length).toBe(16);
    expect(d.hourly.length).toBe(24);
    expect(d.projectOptions[0]!.short).toBe("facts");
  });
  test("setFilterTag replaces only its own tag", () => {
    expect(setFilterTag("review s:codex", "s", "Claude Code")).toBe("review s:claude-code");
    expect(setFilterTag("review s:codex p:x", "p", "")).toBe("review s:codex");
    expect(setFilterTag("", "p", "skilled")).toBe("p:skilled");
  });
  test("sort modes via shared view.ts", () => {
    const d = derive(calls, "");
    expect(sortSkills(d.skills, "alpha", true).map(s => s.skill)).toEqual(["commit", "review", "test-noise"]);
    expect(sortSkills(d.skills, "recent", false)[0]!.skill).toBe("review");
    expect(sortSkills(d.skills, "count", true)[0]!.count).toBe(1);
  });
});

describe("keymap", () => {
  const k = (key: string, o: Partial<Parameters<typeof keymap>[0]> = {}) => keymap({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, inInput: false, ...o });
  test("keymap mirrors TUI keys", () => {
    expect(k("s")).toEqual({ type: "sort-cycle" });
    expect(k("Tab")).toEqual({ type: "sort-toggle" });
    expect(k("j")).toEqual({ type: "move", by: 1 });
    expect(k("k")).toEqual({ type: "move", by: -1 });
    expect(k("g")).toEqual({ type: "move-to", to: "top" });
    expect(k("G", { shiftKey: true })).toEqual({ type: "move-to", to: "bottom" });
    expect(k("d", { ctrlKey: true })).toEqual({ type: "page", dir: 1 });
    expect(k("u", { ctrlKey: true })).toEqual({ type: "page", dir: -1 });
    expect(k("Enter")).toEqual({ type: "detail-toggle" });
    expect(k("a")).toEqual({ type: "audit-toggle" });
    expect(k("/")).toEqual({ type: "filter-focus" });
    expect(k("f")).toEqual({ type: "filter-focus" });
    expect(k("r")).toEqual({ type: "refresh" });
    expect(k("Escape")).toEqual({ type: "escape" });
    expect(k("q")).toEqual({ type: "quit" });
  });
  test("keymap view shortcuts and typing safety", () => {
    expect(k("3", { ctrlKey: true })).toEqual({ type: "view", view: "audit" });
    expect(k("5", { metaKey: true })).toEqual({ type: "view", view: "settings" });
    expect(k("r", { metaKey: true })).toEqual({ type: "refresh" });
    expect(k("s", { inInput: true })).toBeNull();
    expect(k("Escape", { inInput: true })).toEqual({ type: "escape" });
    expect(k("x")).toBeNull();
  });
});

describe("export", () => {
  test("csv escaping and shape", () => {
    expect(csvEscape('a,"b"')).toBe('"a,""b"""');
    expect(csvEscape(new Date(0))).toBe("1970-01-01T00:00:00.000Z");
    const csv = toCsv(exporters.calls(calls.slice(0, 1)));
    expect(csv.split("\n")[0]).toBe("skill,timestamp,project,sessionId,source,file");
    expect(csv.trim().split("\n").length).toBe(2);
    expect(toCsv([], ["a", "b"])).toBe("a,b\n");
  });
  test("every view has a csv and json exporter", () => {
    const d = derive(calls, "");
    expect(toCsv(exporters.skills(d.skills))).toContain("review,2");
    expect(toCsv(exporters.auditRows(d.audit))).toContain("section,skill,detail");
    expect(JSON.parse(toJson(exporters.audit(d.audit)))).toHaveProperty("crossProject");
    const det = skillDetail(calls, "review");
    expect(toCsv(exporters.detailRows(det))).toContain("review,skilled,2");
    expect(JSON.parse(toJson(exporters.detail(det))).weeklyUsage.length).toBe(16);
    expect(toCsv(exporters.providers(mockSnapshot(10).providers))).toContain("Claude Code,true");
  });
});

describe("performance", () => {
  test("50k calls aggregate under 500ms", () => {
    const snap = mockSnapshot(50_000);
    const big = hydrate(snap.calls);
    const t0 = performance.now();
    const d = derive(big, "");
    const detail = skillDetail(d.filtered, d.skills[0]!.skill);
    const ms = performance.now() - t0;
    expect(d.filtered.length).toBe(50_000);
    expect(detail.count).toBeGreaterThan(0);
    expect(ms).toBeLessThan(500);
  });
});
