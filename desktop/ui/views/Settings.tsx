import { useEffect, useState } from "react";
import type { AppInfo, PathOverrides, ProviderInfo, Settings } from "../lib/bridge";

interface Props { settings: Settings; onSave: (s: Settings) => Promise<void>; info: AppInfo | null; providers: ProviderInfo[] }

const PATH_KEYS: { key: keyof PathOverrides; slug: string; label: string; hint: string }[] = [
  { key: "claudeCode", slug: "claude-code", label: "Claude Code", hint: "config dir containing history.jsonl and projects/ (default ~/.claude or $CLAUDE_CONFIG_DIR)" },
  { key: "codex", slug: "codex", label: "Codex CLI", hint: "sessions directory (default ~/.codex/sessions or $CODEX_HOME/sessions)" },
  { key: "droid", slug: "droid", label: "Droid CLI", hint: "sessions directory (default ~/.factory/sessions)" },
  { key: "opencode", slug: "opencode", label: "OpenCode", hint: "opencode.db file (default ~/.local/share/opencode/opencode.db)" },
  { key: "grok", slug: "grok", label: "Grok CLI", hint: "sessions directory (default ~/.grok/sessions)" },
];

const lines = (xs: string[]) => xs.join("\n");
const parseLines = (s: string) => s.split(/\r?\n|,/).map(x => x.trim()).filter(Boolean);

export function SettingsView({ settings, onSave, info, providers }: Props) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(settings), [settings]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setDraft(d => ({ ...d, [k]: v }));

  return (
    <form className="settings" onSubmit={e => { e.preventDefault(); setSaving(true); void onSave(draft).finally(() => setSaving(false)); }}>
      <section className="panel">
        <h2>Data</h2>
        <label className="row"><span>Reader</span>
          <select value={draft.readerMode} onChange={e => set("readerMode", e.target.value as Settings["readerMode"])}>
            <option value="index">Rust index (default; same ~/.skilled/index.db as the TUI)</option>
            <option value="cli" disabled={!info?.cliAvailable}>TypeScript providers via skilled CLI{info?.cliAvailable ? "" : " (CLI not installed)"}</option>
          </select>
        </label>
        <label className="row"><span>Index DB path</span><input value={draft.dbPath} onChange={e => set("dbPath", e.target.value)} placeholder={`${info?.home ?? "~"}/.skilled/index.db`} spellCheck={false} /></label>
        <label className="row"><span>Auto-refresh</span>
          <select value={draft.refreshIntervalSecs} onChange={e => set("refreshIntervalSecs", Number(e.target.value))}>
            <option value={0}>Never (manual / file watch only)</option><option value={30}>Every 30 seconds</option><option value={60}>Every minute</option><option value={300}>Every 5 minutes</option><option value={900}>Every 15 minutes</option><option value={3600}>Every hour</option>
          </select>
        </label>
        <label className="row check"><input type="checkbox" checked={draft.watchFiles} onChange={e => set("watchFiles", e.target.checked)} /><span>Watch provider directories and refresh when a session changes</span></label>
      </section>

      <section className="panel">
        <h2>Provider paths <span className="muted">leave empty to auto-detect</span></h2>
        {PATH_KEYS.map(p => {
          const live = providers.find(x => x.slug === p.slug);
          return (
            <label key={p.key} className="row path">
              <span>{p.label}<small>{p.hint}</small></span>
              <input value={draft.paths[p.key] ?? ""} onChange={e => set("paths", { ...draft.paths, [p.key]: e.target.value })} placeholder={live && !live.overridden ? live.path : ""} spellCheck={false} />
            </label>
          );
        })}
      </section>

      <section className="panel">
        <h2>Noise filters <span className="muted">one per line, case-insensitive substring</span></h2>
        <label className="row area"><span>Hide skills matching</span><textarea value={lines(draft.noiseSkills)} onChange={e => set("noiseSkills", parseLines(e.target.value))} rows={3} placeholder={"test-\nscratch"} /></label>
        <label className="row area"><span>Hide projects matching</span><textarea value={lines(draft.noiseProjects)} onChange={e => set("noiseProjects", parseLines(e.target.value))} rows={3} placeholder={"/tmp/\nplayground"} /></label>
        <label className="row area"><span>Hide sources matching</span><textarea value={lines(draft.noiseSources)} onChange={e => set("noiseSources", parseLines(e.target.value))} rows={2} placeholder="droid" /></label>
      </section>

      <section className="panel">
        <h2>Appearance &amp; window</h2>
        <label className="row"><span>Theme</span>
          <select value={draft.theme} onChange={e => set("theme", e.target.value as Settings["theme"])}><option value="system">Follow system</option><option value="light">Light</option><option value="dark">Dark</option></select>
        </label>
        <label className="row check"><input type="checkbox" checked={draft.showTray} onChange={e => set("showTray", e.target.checked)} /><span>Show system tray icon with quick stats</span></label>
        <label className="row check"><input type="checkbox" checked={draft.closeToTray} disabled={!draft.showTray} onChange={e => set("closeToTray", e.target.checked)} /><span>Closing the window keeps Skilled in the tray</span></label>
        <p className="muted small">Window size and position are restored automatically. Settings file: <span className="mono">{info?.configDir}/settings.json</span></p>
      </section>

      <div className="form-actions">
        <button type="button" className="btn" onClick={() => setDraft(settings)} disabled={!dirty}>Revert</button>
        <button type="submit" className="btn primary" disabled={!dirty || saving}>{saving ? "Saving…" : "Save & refresh"}</button>
      </div>
    </form>
  );
}
