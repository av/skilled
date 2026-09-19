/**
 * Renderer half of the e2e harness (see src-tauri/src/e2e.rs). Active only when
 * the backend says SKILLED_E2E_DIR is set. Walks every view, snapshots each,
 * reports headings + counts, and the backend exits the app.
 */
import { isTauri } from "./bridge";
import type { View } from "./model";

const ORDER: View[] = ["dashboard", "activity", "audit", "providers", "settings"];

export interface E2EHooks { setView: (v: View) => void; openDetail: () => void; closeDetail: () => void; ready: () => { calls: number; skills: string[]; reader: string } | null }

export async function maybeRunE2E(hooks: E2EHooks): Promise<void> {
  if (!isTauri) return;
  const { invoke } = await import("@tauri-apps/api/core");
  if (!(await invoke<boolean>("e2e_enabled"))) return;
  const errors: string[] = [];
  window.addEventListener("error", e => errors.push(String(e.message)));
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  // wait for data
  let state = hooks.ready();
  for (let i = 0; i < 100 && !state; i++) { await sleep(100); state = hooks.ready(); }
  if (!state) errors.push("snapshot never loaded");
  const views: { view: string; headings: string[]; text_length: number }[] = [];
  const capture = async (name: string) => {
    await sleep(700); // let animations finish
    const headings = [...document.querySelectorAll("h2, h3")].map(h => h.textContent?.trim() ?? "").filter(Boolean);
    views.push({ view: name, headings, text_length: document.body.innerText.length });
    try { await invoke("e2e_shot", { name }); } catch (e) { errors.push(`shot ${name}: ${String(e)}`); }
  };
  for (const v of ORDER) { hooks.setView(v); await capture(v); }
  hooks.setView("dashboard"); await sleep(200); hooks.openDetail(); await capture("detail"); hooks.closeDetail();
  await invoke("e2e_report", { report: { views, calls: state?.calls ?? 0, skills: state?.skills ?? [], reader: state?.reader ?? "", errors } });
}
