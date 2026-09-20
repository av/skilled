/**
 * The only module that talks to Tauri. Everything else is plain React.
 * In a browser (tests / mock preview) `window.__TAURI_INTERNALS__` is absent and
 * the mock backend from `mock.ts` is used instead.
 */
import type { SkillCall } from "../../../src/models";

export interface WireCall { skill: string; timestampMs: number; project: string; sessionId: string; source: string; file: string }
export interface ProviderInfo { name: string; slug: string; available: boolean; calls: number; path: string; overridden: boolean }
export type Reader = "rustIndex" | "tsCli";
export interface Snapshot {
  calls: WireCall[];
  providers: ProviderInfo[];
  reader: Reader;
  indexedAtMs: number;
  reindexed: boolean;
  dbPath: string;
  indexVersion: string | null;
  warnings: string[];
  elapsedMs: number;
}
export type ReaderMode = "index" | "cli";
export type ThemeSetting = "system" | "light" | "dark";
export interface PathOverrides { claudeCode?: string | null; codex?: string | null; droid?: string | null; opencode?: string | null; grok?: string | null }
export interface Settings {
  readerMode: ReaderMode;
  dbPath: string;
  refreshIntervalSecs: number;
  watchFiles: boolean;
  noiseSkills: string[];
  noiseProjects: string[];
  noiseSources: string[];
  theme: ThemeSetting;
  closeToTray: boolean;
  showTray: boolean;
  paths: PathOverrides;
}
export interface AppInfo { version: string; indexVersion: string; platform: string; configDir: string; home: string; cliAvailable: boolean }

export const DEFAULT_SETTINGS: Settings = {
  readerMode: "index", dbPath: "", refreshIntervalSecs: 300, watchFiles: true,
  noiseSkills: [], noiseProjects: [], noiseSources: [], theme: "system", closeToTray: true, showTray: true, paths: {},
};

/** A call carrying its source file, as used by the desktop views. */
export interface DesktopCall extends SkillCall { file: string }

export function hydrate(calls: WireCall[]): DesktopCall[] {
  return calls.map(c => ({ skill: c.skill, timestamp: new Date(c.timestampMs), project: c.project, sessionId: c.sessionId, source: c.source, file: c.file }));
}

export interface Backend {
  snapshot(force: boolean): Promise<Snapshot>;
  getSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<Settings>;
  appInfo(): Promise<AppInfo>;
  /** Native save dialog + write. Resolves to the path written, or null if cancelled. */
  exportFile(defaultName: string, content: string, kind: "json" | "csv"): Promise<string | null>;
  openPath(path: string): Promise<void>;
  revealPath(path: string): Promise<void>;
  pathExists(path: string): Promise<boolean>;
  onCommand(cb: (command: string) => void): () => void;
  onFilesChanged(cb: () => void): () => void;
  setTheme(theme: ThemeSetting): Promise<void>;
  quit(): Promise<void>;
}

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function tauriBackend(): Promise<Backend> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const { save } = await import("@tauri-apps/plugin-dialog");
  const { openPath, revealItemInDir } = await import("@tauri-apps/plugin-opener");
  const sub = (event: string, cb: (payload: unknown) => void) => {
    const p = listen(event, e => cb(e.payload));
    return () => { void p.then(un => un()); };
  };
  return {
    snapshot: force => invoke<Snapshot>("snapshot", { force }),
    getSettings: () => invoke<Settings>("get_settings"),
    saveSettings: settings => invoke<Settings>("save_settings", { settings }),
    appInfo: () => invoke<AppInfo>("app_info"),
    async exportFile(defaultName, content, kind) {
      const path = await save({ defaultPath: defaultName, filters: [{ name: kind.toUpperCase(), extensions: [kind] }] });
      if (!path) return null;
      await invoke("write_export", { path, content });
      return path;
    },
    openPath: path => openPath(path),
    revealPath: path => revealItemInDir(path),
    pathExists: path => invoke<boolean>("path_exists", { path }),
    onCommand: cb => sub("skilled://command", p => cb(String(p))),
    onFilesChanged: cb => sub("skilled://files-changed", () => cb()),
    setTheme: theme => getCurrentWindow().setTheme(theme === "system" ? null : theme),
    quit: () => invoke("quit"),
  };
}

let backendPromise: Promise<Backend> | undefined;
export function backend(): Promise<Backend> {
  if (!backendPromise) backendPromise = isTauri ? tauriBackend() : import("./mock").then(m => m.mockBackend());
  return backendPromise;
}
