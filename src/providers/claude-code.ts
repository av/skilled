import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { SkillCall } from "../models.js";
import type { Provider } from "./base.js";

const CLAUDE_HOME = join(homedir(), ".claude");
const HISTORY_PATH = join(CLAUDE_HOME, "history.jsonl");
const PROJECTS_DIR = join(CLAUDE_HOME, "projects");

const BUILTINS = new Set([
  "clear", "model", "usage", "resume", "new", "quit", "exit", "login",
  "logout", "help", "config", "compact", "doctor", "cost", "effort",
  "memory", "status", "skills", "permissions", "mcp", "terminal-setup",
  "remote-env", "remote-control", "fast",
]);

const SKILL_RE = /^\/([a-zA-Z][a-zA-Z0-9_-]*)$/;

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

      const ts = entry.timestamp ?? 0;
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
      let files: string[];
      try {
        files = readdirSync(projPath).filter(f => f.endsWith(".jsonl"));
      } catch {
        continue;
      }

      // Decode project path from dir name: -home-user-code-foo -> /home/user/code/foo
      const project = "/" + projDir.replace(/^-/, "").replace(/-/g, "/");

      for (const file of files) {
        this.parseSessionFile(join(projPath, file), project, calls, seen);
      }
    }
  }

  private parseSessionFile(
    path: string,
    project: string,
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

    for (const line of content.split("\n")) {
      if (!line.includes('"Skill"')) continue;

      let entry: any;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }

      if (entry.type !== "assistant") continue;
      const msg = entry.message;
      if (!msg?.content) continue;

      for (const part of msg.content) {
        if (part.type !== "tool_use" || part.name !== "Skill") continue;
        const input = part.input ?? {};
        const skill: string = input.skill ?? "";
        if (!skill || BUILTINS.has(skill)) continue;

        const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
        const key = `${skill}:${ts}`;
        if (seen.has(key)) continue;
        seen.add(key);

        calls.push({
          skill,
          timestamp: new Date(ts),
          project,
          sessionId,
          source: this.name,
        });
      }
    }
  }
}
