import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { skillDetail } from "../../src/data";
import { SORT_DEFAULT_ASC, nextSortMode, sortSkills, type SortMode } from "../../src/view";
import { backend, hydrate, DEFAULT_SETTINGS, type AppInfo, type DesktopCall, type Settings, type Snapshot } from "./lib/bridge";
import { VIEWS, applyNoise, derive, exporters, keymap, toCsv, toJson, type View } from "./lib/model";
import { Dashboard } from "./views/Dashboard";
import { Activity } from "./views/Activity";
import { Audit } from "./views/Audit";
import { Providers } from "./views/Providers";
import { SettingsView } from "./views/Settings";
import { Detail } from "./views/Detail";
import { FilterBar } from "./components/FilterBar";
import { StatusBar } from "./components/StatusBar";
import { maybeRunE2E } from "./lib/e2e";

export interface ExportRequest { name: string; json: () => unknown; rows: () => Record<string, unknown>[] }

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const [filterExpr, setFilterExpr] = useState("");
  const [filterFocus, setFilterFocus] = useState(0);
  const [sortMode, setSortMode] = useState<SortMode>("count");
  const [sortAsc, setSortAsc] = useState(false);
  const [selected, setSelected] = useState(0);
  const [detailSkill, setDetailSkill] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const exportRef = useRef<ExportRequest | null>(null);
  const e2eRef = useRef({ snapshot, skills: [] as string[] });

  const say = useCallback((msg: string) => { setToast(msg); window.setTimeout(() => setToast(t => (t === msg ? null : t)), 3500); }, []);

  const refresh = useCallback(async (force: boolean) => {
    setLoading(true);
    try {
      const b = await backend();
      const s = await b.snapshot(force);
      setSnapshot(s); setError(null); setNow(new Date());
      if (s.warnings.length) say(s.warnings[0]!);
    } catch (e) {
      setError(String(e));
    } finally { setLoading(false); }
  }, [say]);

  // boot
  useEffect(() => {
    let off1 = () => {}, off2 = () => {};
    void (async () => {
      const b = await backend();
      const [s, i] = await Promise.all([b.getSettings(), b.appInfo()]);
      setSettings(s); setInfo(i);
      await b.setTheme(s.theme).catch(() => {});
      await refresh(false);
      off1 = b.onCommand(c => { if (c === "refresh") void refresh(true); });
      off2 = b.onFilesChanged(() => void refresh(true));
      void maybeRunE2E({
        setView,
        openDetail: () => setDetailSkill(e2eRef.current.skills[0] ?? null),
        closeDetail: () => setDetailSkill(null),
        setFilter: setFilterExpr,
        cycleSort: () => setSortMode(m => { const n = nextSortMode(m); setSortAsc(SORT_DEFAULT_ASC[n]); return n; }),
        toggleSortDir: () => setSortAsc(a => !a),
        ready: () => { const s = e2eRef.current.snapshot; return s ? { calls: s.calls.length, skills: e2eRef.current.skills, reader: s.reader } : null; },
      });
    })();
    return () => { off1(); off2(); };
  }, [refresh]);

  // interval refresh
  useEffect(() => {
    if (!settings.refreshIntervalSecs) return;
    const id = window.setInterval(() => void refresh(false), settings.refreshIntervalSecs * 1000);
    return () => window.clearInterval(id);
  }, [settings.refreshIntervalSecs, refresh]);

  // theme
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  const allCalls: DesktopCall[] = useMemo(() => (snapshot ? applyNoise(hydrate(snapshot.calls), settings) : []), [snapshot, settings]);
  const derived = useMemo(() => derive(allCalls, filterExpr, now), [allCalls, filterExpr, now]);
  const skills = useMemo(() => sortSkills(derived.skills, sortMode, sortAsc), [derived.skills, sortMode, sortAsc]);
  const detail = useMemo(() => (detailSkill && derived.filtered.some(c => c.skill === detailSkill) ? skillDetail(derived.filtered, detailSkill) : null), [derived.filtered, detailSkill]);
  const detailCalls = useMemo(() => (detailSkill ? derived.filtered.filter(c => c.skill === detailSkill) : []), [derived.filtered, detailSkill]);

  useEffect(() => { if (selected >= skills.length) setSelected(Math.max(0, skills.length - 1)); }, [skills.length, selected]);
  e2eRef.current = { snapshot, skills: skills.map(s => s.skill) };

  const saveSettings = useCallback(async (s: Settings) => {
    const b = await backend();
    const saved = await b.saveSettings(s);
    setSettings(saved);
    await b.setTheme(saved.theme).catch(() => {});
    say("Settings saved");
    void refresh(true);
  }, [refresh, say]);

  const doExport = useCallback(async (req: ExportRequest, kind: "json" | "csv") => {
    const b = await backend();
    const content = kind === "json" ? toJson(req.json()) : toCsv(req.rows());
    const path = await b.exportFile(`${req.name}.${kind}`, content, kind);
    say(path ? `Exported ${path}` : "Export cancelled");
  }, [say]);

  // default export target for the current view
  useEffect(() => {
    const map: Record<View, ExportRequest> = {
      dashboard: { name: "skilled-skills", json: () => exporters.skills(skills), rows: () => exporters.skills(skills) },
      activity: { name: "skilled-calls", json: () => exporters.calls(derived.filtered), rows: () => exporters.calls(derived.filtered) },
      audit: { name: "skilled-audit", json: () => exporters.audit(derived.audit), rows: () => exporters.auditRows(derived.audit) },
      providers: { name: "skilled-providers", json: () => exporters.providers(snapshot?.providers ?? []), rows: () => exporters.providers(snapshot?.providers ?? []) },
      settings: { name: "skilled-settings", json: () => settings, rows: () => [settings as unknown as Record<string, unknown>] },
    };
    exportRef.current = detail && view === "dashboard"
      ? { name: `skilled-${detail.skill}`, json: () => exporters.detail(detail), rows: () => exporters.detailRows(detail) }
      : map[view];
  }, [view, skills, derived, snapshot, settings, detail]);

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      const action = keymap({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey, inInput });
      if (!action) return;
      e.preventDefault();
      const page = 10;
      switch (action.type) {
        case "view": setView(action.view); break;
        case "refresh": void refresh(true); break;
        case "filter-focus": setView("dashboard"); setFilterFocus(n => n + 1); break;
        case "export": if (exportRef.current) void doExport(exportRef.current, "json"); break;
        case "quit": void backend().then(b => b.quit()); break;
        case "sort-cycle": { const m = nextSortMode(sortMode); setSortMode(m); setSortAsc(SORT_DEFAULT_ASC[m]); setSelected(0); break; }
        case "sort-toggle": setSortAsc(a => !a); setSelected(0); break;
        case "move": setSelected(i => Math.min(Math.max(0, i + action.by), Math.max(0, skills.length - 1))); break;
        case "move-to": setSelected(action.to === "top" ? 0 : Math.max(0, skills.length - 1)); break;
        case "page": setSelected(i => Math.min(Math.max(0, i + action.dir * page), Math.max(0, skills.length - 1))); break;
        case "detail-toggle": {
          const target = skills[selected]?.skill ?? null;
          setDetailSkill(d => (d && d === target ? null : target));
          if (view !== "dashboard") setView("dashboard");
          break;
        }
        case "audit-toggle": setView(v => (v === "audit" ? "dashboard" : "audit")); break;
        case "escape":
          if (inInput) { (target as HTMLElement).blur(); break; }
          if (detailSkill) setDetailSkill(null);
          else if (view !== "dashboard") setView("dashboard");
          else if (filterExpr) setFilterExpr("");
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [refresh, doExport, sortMode, skills, selected, view, detailSkill, filterExpr]);

  // keep detail on the selected skill in sync when selection moves while detail is open
  useEffect(() => {
    if (detailSkill && skills[selected] && skills[selected]!.skill !== detailSkill && document.activeElement === document.body) {
      setDetailSkill(skills[selected]!.skill);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const isMac = info?.platform === "macos";
  const mod = isMac ? "⌘" : "Ctrl";

  return (
    <div className="app" data-view={view}>
      <header className="titlebar" data-tauri-drag-region>
        <div className="brand" data-tauri-drag-region><span className="logo" aria-hidden>▮▮▮</span> Skilled</div>
        <nav className="tabs" aria-label="Views">
          {VIEWS.map(v => (
            <button key={v.id} className={view === v.id ? "tab active" : "tab"} onClick={() => setView(v.id)} title={`${mod}+${v.key}`} aria-current={view === v.id ? "page" : undefined}>{v.label}</button>
          ))}
        </nav>
        <div className="actions">
          <button className="btn" onClick={() => exportRef.current && void doExport(exportRef.current, "json")} title={`Export current view as JSON (${mod}+E)`}>JSON</button>
          <button className="btn" onClick={() => exportRef.current && void doExport(exportRef.current, "csv")} title="Export current view as CSV">CSV</button>
          <button className="btn primary" onClick={() => void refresh(true)} disabled={loading} title={`Refresh (r, ${mod}+R)`}>{loading ? "Refreshing…" : "Refresh"}</button>
        </div>
      </header>

      {view === "dashboard" && (
        <FilterBar expr={filterExpr} onChange={setFilterExpr} focusToken={filterFocus} sources={derived.sourceOptions} projects={derived.projectOptions} sortMode={sortMode} sortAsc={sortAsc}
          onSortCycle={() => { const m = nextSortMode(sortMode); setSortMode(m); setSortAsc(SORT_DEFAULT_ASC[m]); }} onSortToggle={() => setSortAsc(a => !a)} />
      )}

      <main className="content">
        {error && <div className="error" role="alert"><strong>Could not load local history.</strong><pre>{error}</pre><button className="btn" onClick={() => void refresh(true)}>Try again</button></div>}
        {!error && snapshot && view === "dashboard" && (
          detail
            ? <Detail detail={detail} calls={detailCalls} onClose={() => setDetailSkill(null)} onExport={kind => void doExport({ name: `skilled-${detail.skill}`, json: () => exporters.detail(detail), rows: () => exporters.detailRows(detail) }, kind)} skills={skills} selected={selected} onSelect={i => { setSelected(i); setDetailSkill(skills[i]?.skill ?? null); }} />
            : <Dashboard derived={derived} skills={skills} selected={selected} onSelect={i => setSelected(i)} onOpen={i => { setSelected(i); setDetailSkill(skills[i]?.skill ?? null); }} now={now} />
        )}
        {!error && snapshot && view === "activity" && <Activity calls={derived.filtered} filterExpr={filterExpr} onFilter={setFilterExpr} sources={derived.sourceOptions} projects={derived.projectOptions} onNotify={say} />}
        {!error && snapshot && view === "audit" && <Audit audit={derived.audit} onOpenSkill={s => { setDetailSkill(s); setView("dashboard"); }} />}
        {!error && snapshot && view === "providers" && <Providers snapshot={snapshot} info={info} onNotify={say} />}
        {view === "settings" && <SettingsView settings={settings} onSave={saveSettings} info={info} providers={snapshot?.providers ?? []} />}
        {!error && !snapshot && <div className="empty">Reading local history…</div>}
      </main>

      <StatusBar snapshot={snapshot} derived={derived} loading={loading} detail={!!detail} view={view} toast={toast} mod={mod} />
    </div>
  );
}
