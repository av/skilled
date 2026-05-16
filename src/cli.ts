import { parseArgs } from "util";
import type { Provider } from "./providers/base.js";
import type { SkillCall } from "./models.js";
import { skillCounts, dailyCounts, hourlyCounts, skillDetail, auditSkills, projectShort, timeAgo } from "./data.js";

const VERSION = "0.3.0";

const HELP = `skilled — skill usage stats across AI coding tools

Usage: skilled [command] [options]

Commands:
  (none)              Launch interactive TUI dashboard
  list                List all skills with usage counts
  detail <skill>      Show detailed stats for a skill
  audit               Show skill health audit
  providers           List available data providers
  calls               List raw skill invocations
  index               Rebuild the search index

Options:
  -h, --help          Show this help
  -v, --version       Show version
  --json              Output as JSON
  --source <name>     Filter by source (e.g. claude-code, codex)
  --project <name>    Filter by project path substring
  --sort <field>      Sort by: count (default), name, recent
  --limit <n>         Limit output rows
  --no-index          Skip auto-refresh of the index
  --splash            Show splash animation

Examples:
  skilled                          Open the dashboard
  skilled list --json              All skills as JSON
  skilled list --sort recent       Skills sorted by last used
  skilled detail review            Detail view for "review" skill
  skilled calls --source codex     Raw calls from Codex only
  skilled audit --json             Audit report as JSON
  skilled providers                Show which sources are available
  skilled index                    Rebuild the index`;

interface CliResult {
  command: "tui" | "splash" | "list" | "detail" | "audit" | "providers" | "calls" | "index" | "help" | "version";
  json: boolean;
  noIndex: boolean;
  source?: string;
  project?: string;
  sort: "count" | "name" | "recent";
  limit?: number;
  skill?: string;
}

export function parseCli(argv: string[]): CliResult {
  let values: any;
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: argv.slice(2),
      options: {
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
        json: { type: "boolean", default: false },
        source: { type: "string" },
        project: { type: "string" },
        sort: { type: "string", default: "count" },
        limit: { type: "string" },
        splash: { type: "boolean", default: false },
        "no-index": { type: "boolean", default: false },
      },
      allowPositionals: true,
      strict: true,
    }));
  } catch (e: any) {
    console.error(`Error: ${e.message}\n\nRun 'skilled --help' for usage.`);
    process.exit(1);
  }

  if (values.help) return { command: "help", json: false, noIndex: false, sort: "count" };
  if (values.version) return { command: "version", json: false, noIndex: false, sort: "count" };
  if (values.splash) return { command: "splash", json: false, noIndex: false, sort: "count" };

  const sort = (["count", "name", "recent"].includes(values.sort!) ? values.sort : "count") as CliResult["sort"];
  let limit: number | undefined;
  if (values.limit !== undefined) {
    limit = parseInt(values.limit, 10);
    if (Number.isNaN(limit) || limit < 0) {
      console.error("Error: --limit requires a non-negative number");
      process.exit(1);
    }
  }
  const json = values.json ?? false;
  const noIndex = values["no-index"] ?? false;
  const source = values.source;
  const project = values.project;

  const cmd = positionals[0];

  if (!cmd) return { command: "tui", json, noIndex, sort, limit, source, project };

  switch (cmd) {
    case "list":
      return { command: "list", json, noIndex, sort, limit, source, project };
    case "detail": {
      const skill = positionals.slice(1).join(" ");
      if (!skill) {
        console.error("Error: detail requires a skill name\n\nUsage: skilled detail <skill>");
        process.exit(1);
      }
      return { command: "detail", json, noIndex, sort, limit, source, project, skill };
    }
    case "audit":
      return { command: "audit", json, noIndex, sort, limit, source, project };
    case "providers":
      return { command: "providers", json, noIndex, sort, limit, source, project };
    case "calls":
      return { command: "calls", json, noIndex, sort, limit, source, project };
    case "index":
      return { command: "index", json, noIndex: false, sort, limit, source, project };
    default:
      console.error(`Unknown command: ${cmd}\n\nRun 'skilled --help' for usage.`);
      process.exit(1);
  }
}

function matchSource(providerName: string, filter: string): boolean {
  const slug = providerName.toLowerCase().replace(/\s+/g, "-");
  const f = filter.toLowerCase();
  return providerName.toLowerCase() === f || slug === f
    || slug.startsWith(f) || providerName.toLowerCase().startsWith(f);
}

function collectCalls(providers: Provider[], source?: string, project?: string): SkillCall[] {
  let calls: SkillCall[] = [];
  for (const p of providers) {
    if (source && !matchSource(p.name, source)) continue;
    if (!p.available()) continue;
    calls = calls.concat(p.collect());
  }
  if (project) {
    calls = calls.filter(c => c.project.includes(project));
  }
  return calls;
}

function sortSkills(skills: ReturnType<typeof skillCounts>, sort: CliResult["sort"]) {
  switch (sort) {
    case "name":
      return skills.sort((a, b) => a.skill.localeCompare(b.skill));
    case "recent":
      return skills.sort((a, b) => b.lastUsed.getTime() - a.lastUsed.getTime());
    default:
      return skills;
  }
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

function padLeft(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : " ".repeat(n - s.length) + s;
}

export function runCli(providers: Provider[], cli: CliResult): void {
  switch (cli.command) {
    case "help":
      console.log(HELP);
      return;

    case "version":
      console.log(VERSION);
      return;

    case "providers":
      return cmdProviders(providers, cli);

    case "list":
      return cmdList(providers, cli);

    case "detail":
      return cmdDetail(providers, cli);

    case "audit":
      return cmdAudit(providers, cli);

    case "calls":
      return cmdCalls(providers, cli);
  }
}

function cmdProviders(providers: Provider[], cli: CliResult) {
  const rows = providers.map(p => ({
    name: p.name,
    available: p.available(),
  }));

  if (cli.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  console.log(`${pad("SOURCE", 20)} STATUS`);
  console.log(`${"─".repeat(20)} ${"─".repeat(10)}`);
  for (const r of rows) {
    console.log(`${pad(r.name, 20)} ${r.available ? "available" : "not found"}`);
  }
}

function cmdList(providers: Provider[], cli: CliResult) {
  const calls = collectCalls(providers, cli.source, cli.project);
  let skills = sortSkills(skillCounts(calls), cli.sort);
  if (cli.limit !== undefined) skills = skills.slice(0, cli.limit);

  if (cli.json) {
    console.log(JSON.stringify(skills.map(s => ({
      ...s,
      lastUsed: s.lastUsed.toISOString(),
    })), null, 2));
    return;
  }

  if (skills.length === 0) {
    console.log("No skills found.");
    return;
  }

  const maxName = Math.max(...skills.map(s => s.skill.length), 5);
  const nameW = Math.min(maxName, 30);

  console.log(`${pad("SKILL", nameW)} ${padLeft("COUNT", 6)} ${padLeft("PROJ", 5)} ${padLeft("SESS", 5)} LAST USED`);
  console.log(`${"─".repeat(nameW)} ${"─".repeat(6)} ${"─".repeat(5)} ${"─".repeat(5)} ${"─".repeat(10)}`);
  for (const s of skills) {
    console.log(`${pad(s.skill, nameW)} ${padLeft(String(s.count), 6)} ${padLeft(String(s.projects), 5)} ${padLeft(String(s.sessions), 5)} ${timeAgo(s.lastUsed)}`);
  }
  console.log(`\n${skills.length} skills, ${calls.length} total calls`);
}

function cmdDetail(providers: Provider[], cli: CliResult) {
  const calls = collectCalls(providers, cli.source, cli.project);
  const detail = skillDetail(calls, cli.skill!);

  if (detail.count === 0) {
    if (cli.json) {
      console.log(JSON.stringify({ skill: cli.skill, count: 0 }, null, 2));
    } else {
      console.log(`Skill "${cli.skill}" not found.`);
    }
    return;
  }

  if (cli.json) {
    console.log(JSON.stringify({
      ...detail,
      firstUsed: detail.firstUsed.toISOString(),
      lastUsed: detail.lastUsed.toISOString(),
    }, null, 2));
    return;
  }

  console.log(`Skill: ${detail.skill}`);
  console.log(`Calls: ${detail.count}`);
  console.log(`Sessions: ${detail.sessions}`);
  console.log(`First used: ${detail.firstUsed.toISOString().slice(0, 10)}`);
  console.log(`Last used: ${detail.lastUsed.toISOString().slice(0, 10)}`);
  console.log();

  if (detail.projects.length > 0) {
    console.log("Projects:");
    for (const p of detail.projects) {
      console.log(`  ${pad(p.name, 30)} ${p.count}`);
    }
    console.log();
  }

  const max = Math.max(...detail.weeklyUsage, 1);
  const barChars = "▁▂▃▄▅▆▇█";
  const sparkline = detail.weeklyUsage
    .map(v => (v === 0 ? " " : barChars[Math.min(Math.floor((v / max) * 8), 7)]))
    .join("");
  console.log(`Weekly: ${sparkline}  (${detail.weeklyUsage.length}w)`);
}

function cmdAudit(providers: Provider[], cli: CliResult) {
  const calls = collectCalls(providers, cli.source, cli.project);
  const skills = skillCounts(calls);
  const audit = auditSkills(calls, skills);

  if (cli.json) {
    const serialize = (items: any[]) => items.map((item: any) => {
      if (item.skill && typeof item.skill === "object") {
        return { ...item, skill: { ...item.skill, lastUsed: item.skill.lastUsed.toISOString() } };
      }
      if (item.lastUsed) {
        return { ...item, lastUsed: item.lastUsed.toISOString() };
      }
      return item;
    });
    console.log(JSON.stringify({
      mostUsed: serialize(audit.mostUsed),
      rising: serialize(audit.rising),
      declining: serialize(audit.declining),
      crossProject: serialize(audit.crossProject),
      singleProject: serialize(audit.singleProject),
      stale: serialize(audit.stale),
      oneOff: serialize(audit.oneOff),
    }, null, 2));
    return;
  }

  if (calls.length === 0) {
    console.log("No calls found.");
    return;
  }

  const section = (title: string, items: { skill: string; detail: string }[]) => {
    if (items.length === 0) return;
    const nameW = Math.min(Math.max(...items.map(i => i.skill.length), 5), 35);
    console.log(`\n${title}`);
    console.log("─".repeat(title.length));
    for (const item of items) {
      console.log(`  ${pad(item.skill, nameW)} ${item.detail}`);
    }
  };

  const limit = cli.limit ?? 10;

  section("Most Used (last 4w)", audit.mostUsed.slice(0, limit).map(h => ({
    skill: h.skill.skill,
    detail: `${Math.round(h.share * 100)}%   ${h.skill.count} calls   ${h.skill.projects} proj`,
  })));

  section("Rising (↑50%+ last 4w)", audit.rising.slice(0, limit).map(r => ({
    skill: r.skill.skill,
    detail: `${r.priorCount} → ${r.recentCount}   ↑${r.pct}%`,
  })));

  section("Declining (↓50%+ last 4w)", audit.declining.slice(0, limit).map(d => ({
    skill: d.skill.skill,
    detail: `${d.priorCount} → ${d.recentCount}   ↓${d.pct}%`,
  })));

  section("Cross-Project (3+)", audit.crossProject.slice(0, limit).map(s => ({
    skill: s.skill,
    detail: `${s.projects} projects, ${s.count} calls`,
  })));

  section("Single-Project", audit.singleProject.slice(0, limit).map(s => ({
    skill: s.skill,
    detail: `${s.count} calls`,
  })));

  section("Stale (28+ days)", audit.stale.slice(0, limit).map(s => ({
    skill: s.skill,
    detail: `last used ${timeAgo(s.lastUsed)} ago`,
  })));

  section("One-Off", audit.oneOff.slice(0, limit).map(s => ({
    skill: s.skill,
    detail: `used once, ${timeAgo(s.lastUsed)} ago`,
  })));

  console.log();
}

function cmdCalls(providers: Provider[], cli: CliResult) {
  let calls = collectCalls(providers, cli.source, cli.project);
  calls.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  if (cli.limit !== undefined) calls = calls.slice(0, cli.limit);

  if (cli.json) {
    console.log(JSON.stringify(calls.map(c => ({
      skill: c.skill,
      timestamp: c.timestamp.toISOString(),
      project: c.project,
      sessionId: c.sessionId,
      source: c.source,
    })), null, 2));
    return;
  }

  if (calls.length === 0) {
    console.log("No calls found.");
    return;
  }

  const maxSkill = Math.min(Math.max(...calls.map(c => c.skill.length), 5), 25);
  const maxProj = Math.min(Math.max(...calls.map(c => projectShort(c.project).length), 7), 20);

  console.log(`${pad("SKILL", maxSkill)} ${pad("PROJECT", maxProj)} ${pad("SOURCE", 14)} TIMESTAMP`);
  console.log(`${"─".repeat(maxSkill)} ${"─".repeat(maxProj)} ${"─".repeat(14)} ${"─".repeat(20)}`);
  for (const c of calls) {
    console.log(`${pad(c.skill, maxSkill)} ${pad(projectShort(c.project), maxProj)} ${pad(c.source, 14)} ${c.timestamp.toISOString().slice(0, 19).replace("T", " ")}`);
  }
  console.log(`\n${calls.length} calls`);
}
