import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { SkillCall } from "../models.js";
import type { Provider } from "./base.js";

const HISTORY_PATH = join(homedir(), ".claude", "history.jsonl");

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

      const skill = match[1];
      if (BUILTINS.has(skill)) continue;

      calls.push({
        skill,
        timestamp: new Date(entry.timestamp ?? 0),
        project: entry.project ?? "",
        sessionId: entry.sessionId ?? "",
        source: this.name,
      });
    }

    return calls;
  }
}
