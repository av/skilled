/**
 * Frontend data path, end to end and headless: backend snapshot (wire format
 * from Rust) → hydrate → noise filters → derive → sort → every view rendered to
 * HTML with react-dom/server. No Tauri, no browser: the same code the window runs.
 */
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { hydrate, DEFAULT_SETTINGS, type Snapshot } from "../../ui/lib/bridge";
import { mockBackend, mockSnapshot } from "../../ui/lib/mock";
import { applyNoise, derive } from "../../ui/lib/model";
import { sortSkills } from "../../../src/view";
import { skillDetail } from "../../../src/data";
import { Dashboard } from "../../ui/views/Dashboard";
import { Activity } from "../../ui/views/Activity";
import { Audit } from "../../ui/views/Audit";
import { Detail } from "../../ui/views/Detail";
import { Providers } from "../../ui/views/Providers";

const noop = () => {};
const now = new Date("2026-09-20T12:00:00Z");

async function pipeline(snapshot: Snapshot, filter = "", settings = DEFAULT_SETTINGS) {
  const all = applyNoise(hydrate(snapshot.calls), settings);
  const derived = derive(all, filter, now);
  const skills = sortSkills(derived.skills, "count", false);
  return { all, derived, skills };
}

describe("frontend data path (snapshot → views)", () => {
  test("backend snapshot flows through hydrate/derive into the dashboard HTML", async () => {
    const b = await mockBackend();
    const snapshot = await b.snapshot(false);
    const { derived, skills } = await pipeline(snapshot);
    expect(skills.length).toBeGreaterThan(5);
    const html = renderToString(createElement(Dashboard, { derived, skills, selected: 0, onSelect: noop, onOpen: noop, now }));
    expect(html).toContain(String(snapshot.calls.length)); // CALLS stat card
    for (const s of skills.slice(0, 5)) expect(html).toContain(s.skill); // ranked bars
    expect(html).toContain("activity map"); // heatmap
    expect(html).toContain("time of day"); // hourly histogram
    expect((html.match(/class="heat-cell/g) ?? []).length).toBe(16 * 7);
    expect((html.match(/class="hour l\d"/g) ?? []).length).toBe(24);
  });

  test("a wire call with a file lands in the activity view with open/reveal actions", async () => {
    const snapshot = mockSnapshot(60, now.getTime());
    const { derived } = await pipeline(snapshot);
    const html = renderToString(createElement(Activity, { calls: derived.filtered, filterExpr: "", onFilter: noop, sources: derived.sourceOptions, projects: derived.projectOptions, onNotify: noop }));
    expect(html).toContain(snapshot.calls[0]!.sessionId);
    expect(html).toContain("open");
    expect(html).toContain("reveal");
    expect(html).toContain(`calls`);
  });

  test("TUI filter expressions narrow the same data the views render", async () => {
    const snapshot = mockSnapshot(300, now.getTime());
    const full = await pipeline(snapshot);
    const bySource = await pipeline(snapshot, "s:codex");
    expect(bySource.derived.filtered.length).toBeGreaterThan(0);
    expect(bySource.derived.filtered.length).toBeLessThan(full.derived.filtered.length);
    expect(bySource.derived.filtered.every(c => c.source === "Codex CLI")).toBe(true);
    const bySkill = await pipeline(snapshot, "review");
    expect(bySkill.derived.skills.map(s => s.skill)).toEqual(["review"]);
    const html = renderToString(createElement(Dashboard, { derived: bySkill.derived, skills: bySkill.skills, selected: 0, onSelect: noop, onOpen: noop, now }));
    expect(html).toContain(String(bySkill.derived.filtered.length));
  });

  test("noise filters from settings drop calls before derivation", async () => {
    const snapshot = mockSnapshot(300, now.getTime());
    const full = await pipeline(snapshot);
    const muted = await pipeline(snapshot, "", { ...DEFAULT_SETTINGS, noiseSkills: ["review"], noiseProjects: ["infra"] });
    expect(muted.all.length).toBeLessThan(full.all.length);
    expect(muted.all.some(c => c.skill === "review")).toBe(false);
    expect(muted.all.some(c => c.project.endsWith("/infra"))).toBe(false);
  });

  test("audit and detail views render every section from derived data", async () => {
    const snapshot = mockSnapshot(400, now.getTime());
    const { derived, skills } = await pipeline(snapshot);
    const audit = renderToString(createElement(Audit, { audit: derived.audit, onOpenSkill: noop }));
    for (const k of ["MOST USED", "RISING", "DECLINING", "STALE", "CROSS-PROJECT", "ONE-OFF", "SINGLE-PROJECT"]) expect(audit).toContain(k);

    const top = skills[0]!.skill;
    const detail = skillDetail(derived.filtered, top);
    const calls = derived.filtered.filter(c => c.skill === top);
    const html = renderToString(createElement(Detail, { detail, calls, onClose: noop, onExport: noop, skills, selected: 0, onSelect: noop }));
    expect(html).toContain(top);
    expect(html).toContain("weekly trend");
    expect(html).toContain("by project");
    expect(html).toContain(String(calls.length));
  });

  test("providers view reflects reader, detection and overrides from the snapshot", async () => {
    const snapshot = mockSnapshot(50, now.getTime());
    const html = renderToString(createElement(Providers, { snapshot, info: null, onNotify: noop })).replace(/<!-- -->/g, "");
    expect(html).toContain("4 of 5 detected");
    expect(html).toContain("rust index");
    expect(html).toContain("override");
    expect(html).toContain("not found");
    expect(html).toContain("Claude Code");
    expect(html).toContain(snapshot.dbPath);
  });
});
