import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { SkillCall } from "../models.js";
import type { Provider } from "./base.js";

const CODEX_HOME = join(homedir(), ".codex");
const SESSIONS_DIR = join(CODEX_HOME, "sessions");

const BUILTINS = new Set([
  "exit", "help", "model", "clear", "compact", "undo", "diff",
  "history", "settings", "version", "approve", "status",
  "imagegen", "openai-docs", "plugin-creator", "skill-creator", "skill-installer",
]);

const SKILL_NAME_RE = /<name>([^<]+)<\/name>/;

export class CodexProvider implements Provider {
  readonly name = "Codex CLI";

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
    let entries: string[];
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as any;
    } catch {
      return;
    }

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        this.walkSessions(fullPath, calls);
      } else if (entry.name.endsWith(".jsonl")) {
        this.parseSession(fullPath, calls);
      }
    }
  }

  private parseSession(path: string, calls: SkillCall[]) {
    let content: string;
    try {
      content = readFileSync(path, "utf-8");
    } catch {
      return;
    }

    // Extract project (cwd) from session_meta
    let project = "";
    let sessionId = "";
    const lines = content.split("\n");

    for (const line of lines) {
      if (!line.trim()) continue;
      let entry: any;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }

      if (entry.type === "session_meta") {
        project = entry.payload?.cwd ?? "";
        sessionId = entry.payload?.id ?? "";
      }

      // Skills appear as <skill><name>X</name> blocks in response_item payloads
      if (entry.type === "response_item") {
        const payload = entry.payload;
        if (!payload) continue;
        const msgContent = payload.content;
        if (!Array.isArray(msgContent)) continue;

        for (const part of msgContent) {
          if (part.type !== "input_text") continue;
          const text: string = part.text ?? "";
          if (!text.includes("<skill>")) continue;

          const match = text.match(SKILL_NAME_RE);
          if (!match) continue;

          const skill = match[1]!;
          if (BUILTINS.has(skill)) continue;

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
}
