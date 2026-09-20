/**
 * Renderer half of the e2e harness (see src-tauri/src/e2e.rs). Active only when
 * the backend says SKILLED_E2E_DIR is set. Walks every view, snapshots each,
 * reports headings + counts, and the backend exits the app.
 */
import { isTauri } from "./bridge";
import type { View } from "./model";

const ORDER: View[] = ["dashboard", "activity", "audit", "providers", "settings"];

export interface E2EHooks { setView: (v: View) => void; openDetail: () => void; closeDetail: () => void; setFilter: (v: string) => void; cycleSort: () => void; toggleSortDir: () => void; ready: () => { calls: number; skills: string[]; reader: string } | null }

export async function maybeRunE2E(hooks: E2EHooks): Promise<void> {
  if (!isTauri) return;
  const { invoke } = await import("@tauri-apps/api/core");
  const e2e = await invoke<{ enabled: boolean; dwellMs: number; record: boolean }>("e2e_config");
  if (!e2e.enabled) return;
  const dwell = Math.max(900, e2e.dwellMs);
  const errors: string[] = [];
  window.addEventListener("error", e => errors.push(String(e.message)));
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  // wait for data
  let state = hooks.ready();
  for (let i = 0; i < 100 && !state; i++) { await sleep(100); state = hooks.ready(); }
  if (!state) errors.push("snapshot never loaded");
  const views: { view: string; headings: string[]; text_length: number }[] = [];
  if (e2e.record) { try { await invoke("e2e_record", { start: true, fps: 10 }); } catch (e) { errors.push(`record: ${String(e)}`); } }
  const capture = async (name: string) => {
    await sleep(dwell); // let animations finish (longer when recording)
    // A refresh may be in flight (watcher, interval): wait for the view to have content.
    for (let i = 0; i < 50 && !document.querySelector("main h2, main h3"); i++) await sleep(100);
    const err = document.querySelector("main .error");
    if (err) errors.push(`${name}: error panel visible: ${err.textContent?.slice(0, 300)}`);
    // Some compositors never tick CSS animations for a freshly mapped window, which
    // leaves bars and heatmap cells at their first keyframe; jump them to the end.
    try { for (const a of document.getAnimations()) a.finish(); } catch { /* not supported */ }
    await sleep(50);
    const headings = [...document.querySelectorAll("h2, h3")].map(h => h.textContent?.trim() ?? "").filter(Boolean);
    views.push({ view: name, headings, text_length: document.body.innerText.length });
    try { await invoke("e2e_shot", { name }); } catch (e) { errors.push(`shot ${name}: ${String(e)}`); }
  };
  for (const v of ORDER) { hooks.setView(v); await capture(v); }
  hooks.setView("dashboard"); await sleep(200); hooks.openDetail(); await capture("detail"); hooks.closeDetail();
  if (e2e.record) {
    // Recording tour: exercise filter + sorts on the dashboard like the TUI demo.
    hooks.setView("dashboard"); await sleep(dwell / 2);
    hooks.setFilter("s:claude"); await sleep(dwell); hooks.setFilter("review"); await sleep(dwell); hooks.setFilter("");
    hooks.cycleSort(); await sleep(dwell / 2); hooks.cycleSort(); await sleep(dwell / 2); hooks.toggleSortDir(); await sleep(dwell / 2);
    hooks.cycleSort(); hooks.toggleSortDir(); await sleep(dwell / 2);
    hooks.setView("audit"); await sleep(dwell);
  }
  // Live update: a new Claude Code history line is written on disk while the app
  // runs; the watcher must emit files-changed and the UI must re-index and show it.
  let liveCalls: number | null = null;
  hooks.setView("dashboard"); hooks.setFilter(""); await sleep(dwell / 2);
  const before = hooks.ready()?.calls ?? 0;
  try {
    await invoke("e2e_append_call", { skill: "live-update" });
    for (let i = 0; i < 120; i++) { // watcher debounce 1.5s + re-index
      await sleep(100);
      const c = hooks.ready()?.calls ?? 0;
      if (c > before && hooks.ready()?.skills.includes("live-update")) { liveCalls = c; break; }
    }
    if (liveCalls === null) errors.push(`live update not reflected: still ${hooks.ready()?.calls} calls after 12s (before ${before})`);
  } catch (e) { errors.push(`append: ${String(e)}`); }
  await capture("live");
  if (e2e.record) { await sleep(dwell); await invoke("e2e_record", { start: false, fps: 0 }); }
  await invoke("e2e_report", { report: { views, calls: state?.calls ?? 0, skills: state?.skills ?? [], reader: state?.reader ?? "", errors, live_calls: liveCalls } });
}
