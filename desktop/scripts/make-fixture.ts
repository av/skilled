/**
 * Generates tests/fixtures/home: a fake $HOME with histories for all five
 * providers in the shapes the Rust indexer and the TS providers both parse.
 * Deterministic (seeded), dates relative to a fixed anchor unless --now.
 *
 *   bun run scripts/make-fixture.ts            # small fixture committed to git
 *   bun run scripts/make-fixture.ts --large N  # N calls, for perf/manual testing (untracked)
 */
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";

const args = process.argv.slice(2);
const largeIdx = args.indexOf("--large");
const large = largeIdx >= 0 ? Number(args[largeIdx + 1] ?? 50000) : 0;
const outArg = args.indexOf("--out");
const root = resolve(import.meta.dir, "..", outArg >= 0 ? args[outArg + 1]! : large ? "tests/fixtures/home-large" : "tests/fixtures/home");
const useNow = args.includes("--now") || large > 0;

let seed = 42;
const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;

const anchor = useNow ? Date.now() : Date.parse("2026-05-06T15:00:00Z");
const daysAgo = (d: number, h = 12) => anchor - d * 86400000 - (12 - h) * 3600000;
const iso = (ms: number) => new Date(ms).toISOString();

const skills = ["review", "commit", "bugbash", "facts", "timeboxed-iterating", "verification-before-completion", "brainstorm", "release-notes", "one-off-migration", "legacy-audit"];
const projects = ["/home/tester/code/skilled", "/home/tester/code/facts", "/home/tester/code/website", "/home/tester/code/infra"];

rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });

// --- Claude Code ------------------------------------------------------------
const claude = join(root, ".claude");
mkdirSync(join(claude, "projects", "-home-tester-code-skilled"), { recursive: true });
const history: string[] = [];
const claudeCalls = large ? Math.floor(large * 0.3) : 8;
for (let i = 0; i < claudeCalls; i++) {
  const skill = large ? pick(skills) : ["review", "review", "commit", "bugbash", "facts", "review", "clear", "brainstorm"][i]!;
  const ts = large ? daysAgo(Math.floor(rand() * 110), Math.floor(rand() * 24)) : daysAgo([1, 2, 3, 5, 8, 13, 21, 60][i]!, 9 + i);
  history.push(JSON.stringify({ display: `/${skill} please`, timestamp: ts, project: large ? pick(projects) : projects[i % 2], sessionId: `claude-s${i}` }));
}
writeFileSync(join(claude, "history.jsonl"), history.join("\n") + "\n");
const session = [
  JSON.stringify({ type: "user", cwd: projects[0], timestamp: iso(daysAgo(4, 10)), message: { role: "user", content: "hi" } }),
  JSON.stringify({ type: "assistant", cwd: projects[0], timestamp: iso(daysAgo(4, 10)), message: { role: "assistant", content: [{ type: "tool_use", name: "Skill", input: { skill: "release-notes" } }] } }),
  JSON.stringify({ type: "assistant", cwd: projects[0], timestamp: iso(daysAgo(4, 11)), message: { role: "assistant", content: [{ type: "tool_use", name: "Skill", input: { skill: "review" } }] } }),
];
writeFileSync(join(claude, "projects", "-home-tester-code-skilled", "abc-session.jsonl"), session.join("\n") + "\n");

// --- Codex --------------------------------------------------------------------
const codexDir = join(root, ".codex", "sessions", "2026", "05");
mkdirSync(codexDir, { recursive: true });
const codexCalls = large ? Math.floor(large * 0.25) : 3;
const codexLines = [JSON.stringify({ type: "session_meta", timestamp: iso(daysAgo(6)), payload: { id: "codex-s1", cwd: projects[1] } })];
for (let i = 0; i < codexCalls; i++) {
  const skill = large ? pick(skills) : ["facts", "commit", "timeboxed-iterating"][i]!;
  codexLines.push(JSON.stringify({ type: "response_item", timestamp: iso(large ? daysAgo(Math.floor(rand() * 110)) : daysAgo(6, 10 + i)), payload: { content: [{ type: "input_text", text: `<skill><name>${skill}</name></skill> go` }] } }));
}
writeFileSync(join(codexDir, "rollout-codex-s1.jsonl"), codexLines.join("\n") + "\n");

// --- Droid --------------------------------------------------------------------
const droidDir = join(root, ".factory", "sessions");
mkdirSync(droidDir, { recursive: true });
const droidLines = [JSON.stringify({ type: "session_start", id: "droid-s1", cwd: projects[2] })];
const droidCalls = large ? Math.floor(large * 0.1) : 2;
for (let i = 0; i < droidCalls; i++) {
  const skill = large ? pick(skills) : ["bugbash", "legacy-audit"][i]!;
  droidLines.push(JSON.stringify({ type: "message", timestamp: iso(large ? daysAgo(Math.floor(rand() * 110)) : daysAgo(i === 1 ? 45 : 2, 14)), message: { content: [{ type: "tool_result", content: `Skill "${skill}" is now active` }] } }));
}
writeFileSync(join(droidDir, "droid-s1.jsonl"), droidLines.join("\n") + "\n");

// --- OpenCode -----------------------------------------------------------------
const ocDir = join(root, ".local", "share", "opencode");
mkdirSync(ocDir, { recursive: true });
const dbPath = join(ocDir, "opencode.db");
if (existsSync(dbPath)) rmSync(dbPath);
const db = new Database(dbPath);
db.exec("CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT); CREATE TABLE part (id TEXT PRIMARY KEY, session_id TEXT, data TEXT);");
db.exec(`INSERT INTO session VALUES ('oc-s1', '${projects[3]}'), ('oc-s2', '${projects[0]}')`);
const ins = db.prepare("INSERT INTO part VALUES (?, ?, ?)");
const ocCalls = large ? large - claudeCalls - codexCalls - droidCalls - Math.floor(large * 0.05) : 3;
for (let i = 0; i < ocCalls; i++) {
  const skill = large ? pick(skills) : ["verification-before-completion", "verification-before-completion", "review"][i]!;
  ins.run(`p${i}`, i % 2 ? "oc-s1" : "oc-s2", JSON.stringify({ type: "tool", tool: "skill", state: { status: "completed", input: { name: skill }, time: { start: iso(large ? daysAgo(Math.floor(rand() * 110)) : daysAgo(1 + i, 16)) } } }));
}
db.close();

// --- Grok -----------------------------------------------------------------------
const grokProj = join(root, ".grok", "sessions", encodeURIComponent(projects[1]!), "0190a1b2-0000-7000-8000-000000000001");
mkdirSync(grokProj, { recursive: true });
const grokCalls = large ? Math.floor(large * 0.05) : 2;
const grokLines: string[] = [];
for (let i = 0; i < grokCalls; i++) {
  const skill = large ? pick(skills) : ["facts", "brainstorm"][i]!;
  grokLines.push(JSON.stringify({ timestamp: (large ? daysAgo(Math.floor(rand() * 110)) : daysAgo(3, 9 + i)) / 1000, params: { sessionId: "grok-s1", update: { sessionUpdate: "user_message_chunk", content: { type: "text", text: `<command-name>${skill}</command-name>` } } } }));
}
writeFileSync(join(grokProj, "updates.jsonl"), grokLines.join("\n") + "\n");

const total = claudeCalls + 2 + codexCalls + droidCalls + ocCalls + grokCalls;
console.log(`fixture written to ${root} (~${total} calls incl. 1 builtin filtered)`);
