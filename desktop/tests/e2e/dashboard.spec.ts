/**
 * End-to-end: launch the real desktop binary against the committed fixture
 * $HOME in harness mode (SKILLED_E2E_DIR). The renderer walks every view,
 * snapshots each one (Linux) and posts report.json before the app exits.
 *
 *   bun run test:e2e            # needs src-tauri/target/debug/skilled-desktop (scripts/dev-check.sh)
 *   SKILLED_E2E_BIN=…           # test a different binary (e.g. a release bundle's executable)
 *
 * On Linux a display is required (Wayland, X11, or xvfb-run in CI).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const fixture = resolve(root, "tests/fixtures/home");
const exe = process.platform === "win32" ? "skilled-desktop.exe" : "skilled-desktop";
const bin = process.env.SKILLED_E2E_BIN ?? resolve(root, "src-tauri/target/debug", exe);

interface Report {
  views: { view: string; headings: string[]; text_length: number }[];
  calls: number;
  skills: string[];
  reader: string;
  errors: string[];
  live_calls: number | null;
}

let out = "";
let cfg = "";
let home = "";
let report: Report;
let exitCode: number | null = null;
let stderr = "";

beforeAll(async () => {
  if (!existsSync(bin)) throw new Error(`desktop binary not found: ${bin} (run scripts/dev-check.sh first)`);
  if (!existsSync(fixture)) throw new Error(`fixture missing: ${fixture} (bun run scripts/make-fixture.ts)`);
  out = mkdtempSync(join(tmpdir(), "skilled-e2e-"));
  cfg = mkdtempSync(join(tmpdir(), "skilled-e2e-cfg-"));
  // The app writes ~/.skilled/index.db into $HOME: run against a throwaway copy
  // so the committed fixture stays pristine.
  home = join(out, "home");
  cpSync(fixture, home, { recursive: true });
  const proc = Bun.spawn([bin], {
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: cfg,
      SKILLED_E2E_DIR: out,
      SKILLED_E2E_DWELL_MS: "400",
    },
    stdout: "ignore",
    stderr: "pipe",
  });
  const timer = setTimeout(() => proc.kill(), 90_000);
  stderr = await new Response(proc.stderr).text();
  exitCode = await proc.exited;
  clearTimeout(timer);
  const path = join(out, "report.json");
  if (!existsSync(path)) throw new Error(`no report.json written (exit ${exitCode})\n${stderr}`);
  report = JSON.parse(readFileSync(path, "utf8")) as Report;
  // Keep the report in the CI log so a failing assertion can be diagnosed without artifacts.
  console.log(`e2e report: reader=${report.reader} calls=${report.calls} live=${report.live_calls} errors=${JSON.stringify(report.errors)}`);
  for (const v of report.views) console.log(`  ${v.view}: ${v.text_length} chars, headings=${JSON.stringify(v.headings)}`);
  if (stderr.trim()) console.log(`app stderr:\n${stderr.trim().slice(0, 2000)}`);
});

afterAll(() => {
  if (process.env.SKILLED_E2E_KEEP) { console.log(`e2e output kept in ${out}`); return; }
  rmSync(out, { recursive: true, force: true });
  rmSync(cfg, { recursive: true, force: true });
});

describe("desktop e2e (real binary + fixture home)", () => {
  test("app exits cleanly after the tour with no renderer errors", () => {
    expect(exitCode).toBe(0);
    expect(report.errors).toEqual([]);
  });

  test("indexes the fixture in-process with the Rust reader", () => {
    expect(report.reader).toBe("rustIndex");
    expect(report.calls).toBeGreaterThan(10);
  });

  test("dashboard renders the fixture skills", () => {
    for (const skill of ["review", "commit", "bugbash", "facts"]) expect(report.skills).toContain(skill);
    const dash = report.views.find(v => v.view === "dashboard");
    expect(dash).toBeDefined();
    expect(dash!.headings.some(h => h.includes("skill usage"))).toBe(true);
    expect(dash!.headings.some(h => h.includes("activity"))).toBe(true);
    expect(dash!.headings.some(h => h.includes("time of day"))).toBe(true);
    expect(dash!.text_length).toBeGreaterThan(300);
  });

  test("every view renders with content", () => {
    const names = report.views.map(v => v.view);
    expect(names).toEqual(["dashboard", "activity", "audit", "providers", "settings", "detail", "live"]);
    for (const v of report.views) expect(v.text_length).toBeGreaterThan(100);
    const audit = report.views.find(v => v.view === "audit")!;
    for (const k of ["MOST USED", "RISING", "DECLINING", "STALE", "CROSS-PROJECT", "ONE-OFF", "SINGLE-PROJECT"]) {
      expect(audit.headings.some(h => h.includes(k))).toBe(true);
    }
    const providers = report.views.find(v => v.view === "providers")!;
    expect(providers.headings.some(h => h.includes("5 of 5"))).toBe(true);
    const detail = report.views.find(v => v.view === "detail")!;
    expect(detail.headings.some(h => h.includes("weekly usage"))).toBe(true);
  });

  test("a history line written while the app runs shows up via the file watcher", () => {
    expect(report.live_calls).not.toBeNull();
    expect(report.live_calls!).toBe(report.calls + 1);
    expect(existsSync(join(home, ".claude/history.jsonl"))).toBe(true);
    expect(readFileSync(join(home, ".claude/history.jsonl"), "utf8")).toContain("/live-update now");
  });

  test("snapshots are written for every view on Linux", () => {
    if (process.platform !== "linux") return;
    for (const v of ["dashboard", "activity", "audit", "providers", "settings", "detail", "live"]) {
      const png = join(out, `${v}.png`);
      expect(existsSync(png)).toBe(true);
      expect(statSync(png).size).toBeGreaterThan(10_000);
    }
  });
});
