import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { SkillCall } from "../models.js";
import type { Provider } from "./base.js";

const FACTORY_HOME = join(homedir(), ".factory");
const SESSIONS_DIR = join(FACTORY_HOME, "sessions");

const SKILL_ACTIVE_RE = /Skill "([^"]+)" is now active/;

export class DroidProvider implements Provider {
  readonly name = "Droid CLI";

  available(): boolean {
    return existsSync(SESSIONS_DIR);
  }

  collect(): SkillCall[] {
    if (!this.available()) return [];

    const calls: SkillCall[] = [];
    this.walkSessions(SESSIONS_DIR, calls);
    return calls;
  }

  private walkSessions(dir: string, calls: SkillCall[]) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        this.walkSessions(fullPath, calls);
      } else if (entry.name.endsWith(".jsonl")) {
        this.parseSession(fullPath, dir, calls);
      }
    }
  }

  private parseSession(path: string, parentDir: string, calls: SkillCall[]) {
    let content: string;
    try {
      content = readFileSync(path, "utf-8");
    } catch {
      return;
    }

    // Derive project from directory structure: sessions/{project-slug}/session.jsonl
    const relDir = parentDir.replace(SESSIONS_DIR, "").replace(/^\//, "");
    const project = relDir ? "/" + relDir.replace(/-/g, "/") : "";

    const lines = content.split("\n");
    let sessionId = "";

    for (const line of lines) {
      if (!line.trim()) continue;
      let entry: any;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }

      if (entry.type === "session_start") {
        sessionId = entry.id ?? "";
      }

      if (entry.type !== "message") continue;
      const msg = entry.message;
      if (!msg) continue;

      const msgContent = msg.content;
      if (!Array.isArray(msgContent)) continue;

      for (const part of msgContent) {
        if (part.type !== "tool_result") continue;
        const text: string = typeof part.content === "string"
          ? part.content
          : "";
        const match = text.match(SKILL_ACTIVE_RE);
        if (!match) continue;

        const skill = match[1]!;
        const ts = entry.timestamp
          ? new Date(entry.timestamp)
          : new Date(0);

        calls.push({
          skill,
          timestamp: ts,
          project,
          sessionId,
          source: this.name,
        });
      }
    }
  }
}
