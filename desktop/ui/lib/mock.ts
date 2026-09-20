/** Browser-only backend used for `bun run scripts/build.ts --serve` previews and tests. */
import { DEFAULT_SETTINGS, type Backend, type Settings, type Snapshot, type WireCall } from "./bridge";

export function mockSnapshot(n = 400, now = Date.now()): Snapshot {
  let seed = 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const skills = ["review", "commit", "bugbash", "facts", "timeboxed-iterating", "verification-before-completion", "brainstorm", "release-notes", "one-off-migration", "legacy-audit", "docs", "refactor"];
  const sources = ["Claude Code", "Codex CLI", "OpenCode", "Grok CLI", "Droid CLI"];
  const projects = ["/home/tester/code/skilled", "/home/tester/code/facts", "/home/tester/code/website", "/home/tester/code/infra"];
  const calls: WireCall[] = [];
  for (let i = 0; i < n; i++) {
    const daysAgo = Math.floor(rand() ** 1.6 * 110);
    const ts = now - daysAgo * 86400000 - Math.floor(rand() * 86400000);
    const source = sources[Math.floor(rand() * sources.length)]!;
    calls.push({ skill: skills[Math.floor(rand() ** 1.8 * skills.length)]!, timestampMs: ts, project: projects[Math.floor(rand() * projects.length)]!, sessionId: `s-${Math.floor(rand() * 120)}`, source, file: `/home/tester/.history/${source.toLowerCase().replace(/\s+/g, "-")}/session.jsonl` });
  }
  calls.sort((a, b) => b.timestampMs - a.timestampMs);
  const bySource = new Map<string, number>();
  for (const c of calls) bySource.set(c.source, (bySource.get(c.source) ?? 0) + 1);
  return {
    calls,
    providers: sources.map((name, i) => ({ name, slug: name.toLowerCase().replace(/\s+/g, "-"), available: i !== 4, calls: i === 4 ? 0 : bySource.get(name) ?? 0, path: `/home/tester/.${name.split(" ")[0]!.toLowerCase()}`, overridden: i === 1 })),
    reader: "rustIndex",
    indexedAtMs: now - 42_000,
    reindexed: true,
    dbPath: "/home/tester/.skilled/index.db",
    indexVersion: "0.3.3",
    warnings: [],
    elapsedMs: 12,
  };
}

export function mockBackend(): Backend {
  let settings: Settings = { ...DEFAULT_SETTINGS };
  const commands = new Set<(c: string) => void>();
  if (typeof window !== "undefined") {
    (window as unknown as { __skilledMock: unknown }).__skilledMock = { command: (c: string) => commands.forEach(cb => cb(c)) };
  }
  return {
    snapshot: async () => mockSnapshot(),
    getSettings: async () => settings,
    saveSettings: async s => (settings = s),
    appInfo: async () => ({ version: "0.3.3-mock", indexVersion: "0.3.3", platform: "browser", configDir: "/home/tester/.config/skilled", home: "/home/tester", cliAvailable: true }),
    exportFile: async (name, content) => { console.log(`[mock export] ${name} (${content.length} bytes)`); return `/tmp/${name}`; },
    openPath: async p => console.log("[mock open]", p),
    revealPath: async p => console.log("[mock reveal]", p),
    pathExists: async () => true,
    onCommand: cb => { commands.add(cb); return () => commands.delete(cb); },
    onFilesChanged: () => () => {},
    setTheme: async () => {},
    quit: async () => console.log("[mock quit]"),
  };
}
