import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { SkillCall } from "../models.js";
import type { Provider } from "./base.js";

const CLAUDE_HOME = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
const HISTORY_PATH = join(CLAUDE_HOME, "history.jsonl");
const PROJECTS_DIR = join(CLAUDE_HOME, "projects");

const BUILTINS = new Set([
  "clear", "model", "usage", "resume", "new", "quit", "exit", "login",
  "logout", "help", "config", "compact", "doctor", "cost", "effort",
  "memory", "status", "skills", "permissions", "mcp", "terminal-setup",
  "remote-env", "remote-control", "fast",
]);

const SKILL_RE = /^\/([a-zA-Z][a-zA-Z0-9_-]*)(?:\s|$)/;

export class ClaudeCodeProvider implements Provider {
  readonly name = "Claude Code";

  available(): boolean {
    return existsSync(HISTORY_PATH);
  }

  collect(): SkillCall[] {
    if (!this.available()) return [];

    const calls: SkillCall[] = [];
    const seen = new Set<string>();

    // Source 1: history.jsonl — tracks /slash-command invocations
    const lines = readFileSync(HISTORY_PATH, "utf-8").split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      let entry: any;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }

      const display: string = entry.display ?? "";
      const match = display.match(SKILL_RE);
      if (!match) continue;

      const skill = match[1]!;
      if (BUILTINS.has(skill)) continue;

      const rawTs = entry.timestamp ?? 0;
      const ts = typeof rawTs === "number" && Number.isFinite(rawTs) ? rawTs : 0;
      const key = `${skill}:${ts}`;
      if (seen.has(key)) continue;
      seen.add(key);

      calls.push({
        skill,
        timestamp: new Date(ts),
        project: entry.project ?? "",
        sessionId: entry.sessionId ?? "",
        source: this.name,
      });
    }

    // Source 2: session JSONL files — Skill tool invocations
    if (existsSync(PROJECTS_DIR)) {
      this.collectFromProjects(calls, seen);
    }

    return calls;
  }

  private collectFromProjects(calls: SkillCall[], seen: Set<string>) {
    let projectDirs: string[];
    try {
      projectDirs = readdirSync(PROJECTS_DIR);
    } catch {
      return;
    }

    for (const projDir of projectDirs) {
      const projPath = join(PROJECTS_DIR, projDir);
      this.walkJsonlFiles(projPath, calls, seen);
    }
  }

  private walkJsonlFiles(dir: string, calls: SkillCall[], seen: Set<string>) {
    let entries: import("fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        this.walkJsonlFiles(fullPath, calls, seen);
      } else if (entry.name.endsWith(".jsonl")) {
        this.parseSessionFile(fullPath, calls, seen);
      }
    }
  }

  private parseSessionFile(
    path: string,
    calls: SkillCall[],
    seen: Set<string>,
  ) {
    let content: string;
    try {
      content = readFileSync(path, "utf-8");
    } catch {
      return;
    }

    const sessionId = path.replace(/.*\//, "").replace(".jsonl", "");

    // Extract project path (cwd) from session entries rather than
    // decoding the directory name, which is ambiguous when paths contain hyphens.
    let project = "";

    for (const line of content.split("\n")) {
      if (!line.trim()) continue;

      // Fast path: extract cwd from any early entry that has it
      if (!project && line.includes('"cwd"')) {
        try {
          const entry = JSON.parse(line);
          if (entry.cwd) project = entry.cwd;
        } catch {
          // ignore parse errors
        }
      }

      if (!line.includes('"Skill"')) continue;

      let entry: any;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }

      if (!project && entry.cwd) project = entry.cwd;

      if (entry.type !== "assistant") continue;
      const msg = entry.message;
      if (!msg?.content) continue;

      for (const part of msg.content) {
        if (part.type !== "tool_use" || part.name !== "Skill") continue;
        const input = part.input ?? {};
        const skill: string = input.skill ?? "";
        if (!skill || BUILTINS.has(skill)) continue;

        const rawTs = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
        const ts = Number.isFinite(rawTs) ? rawTs : 0;
        const key = `${skill}:${ts}`;
        if (seen.has(key)) continue;
        seen.add(key);

        calls.push({
          skill,
          timestamp: new Date(ts),
          project: project || entry.cwd || "",
          sessionId,
          source: this.name,
        });
      }
    }
  }
}
