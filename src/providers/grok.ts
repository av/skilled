import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { SkillCall } from "../models.js";
import type { Provider } from "./base.js";

const SESSIONS_DIR = join(homedir(), ".grok", "sessions");

const BUILTINS = new Set([
  "compact", "always-approve", "context", "plugins", "reload-plugins",
  "session-info", "imagine", "imagine-video", "feedback", "loop",
  "help", "memory", "clear", "exit",
]);

const COMMAND_NAME_RE = /<command-name>([^<]+)<\/command-name>/g;

/** Extract millisecond timestamp from a UUIDv7 string (first 48 bits). */
function uuidv7ToMs(uuid: string): number {
  const hex = uuid.replace(/-/g, "").slice(0, 12);
  return parseInt(hex, 16) || 0;
}

export class GrokProvider implements Provider {
  readonly name = "Grok CLI";

  available(): boolean {
    return existsSync(SESSIONS_DIR);
  }

  collect(): SkillCall[] {
    if (!this.available()) return [];

    const calls: SkillCall[] = [];

    let projectDirs: string[];
    try {
      projectDirs = readdirSync(SESSIONS_DIR).filter(e => e.startsWith("%2F"));
    } catch {
      return [];
    }

    for (const projEntry of projectDirs) {
      const project = decodeURIComponent(projEntry);
      const projDir = join(SESSIONS_DIR, projEntry);

      // Walk session subdirectories
      let sessionDirs: string[];
      try {
        sessionDirs = readdirSync(projDir, { withFileTypes: true })
          .filter(e => e.isDirectory())
          .map(e => e.name);
      } catch {
        continue;
      }

      for (const sessionDir of sessionDirs) {
        // Track skills already found from updates.jsonl to avoid duplicates
        const seen = new Set<string>();

        // Source 1: updates.jsonl — has per-message timestamps
        const updatesPath = join(projDir, sessionDir, "updates.jsonl");
        if (existsSync(updatesPath)) {
          let content: string;
          try {
            content = readFileSync(updatesPath, "utf-8");
          } catch {
            content = "";
          }

          for (const line of content.split("\n")) {
            if (!line.trim()) continue;
            let record: any;
            try {
              record = JSON.parse(line);
            } catch {
              continue;
            }

            const params = record.params;
            if (!params) continue;
            const update = params.update;
            if (!update || update.sessionUpdate !== "user_message_chunk") continue;

            const msgContent = update.content;
            if (!msgContent || msgContent.type !== "text") continue;

            const text: string = msgContent.text ?? "";
            for (const m of text.matchAll(COMMAND_NAME_RE)) {
              const skill = m[1]!;
              if (BUILTINS.has(skill)) continue;

              seen.add(skill);
              const ts = record.timestamp
                ? new Date(record.timestamp * 1000)
                : new Date(0);

              calls.push({
                skill,
                timestamp: ts,
                project,
                sessionId: params.sessionId ?? sessionDir,
                source: this.name,
              });
            }
          }
        }

        // Source 2: chat_history.jsonl — captures all user skill invocations
        // that may not appear in updates.jsonl (e.g., subagent-spawned sessions,
        // sessions where the update stream was incomplete).
        const chatPath = join(projDir, sessionDir, "chat_history.jsonl");
        if (existsSync(chatPath)) {
          let content: string;
          try {
            content = readFileSync(chatPath, "utf-8");
          } catch {
            content = "";
          }

          // Use UUIDv7 session timestamp as fallback (no per-message timestamps in chat_history)
          const sessionTs = new Date(uuidv7ToMs(sessionDir));

          for (const line of content.split("\n")) {
            if (!line.trim() || !line.includes("command-name")) continue;
            let record: any;
            try {
              record = JSON.parse(line);
            } catch {
              continue;
            }

            if (record.type !== "user") continue;

            const text: string = typeof record.content === "string"
              ? record.content
              : Array.isArray(record.content)
                ? record.content.map((p: any) => p?.text ?? "").join("")
                : "";

            // Skip background_context messages — these replay the parent session's
            // history into subagent sessions and do not represent real skill invocations.
            if (text.includes("<background_context>")) continue;

            for (const m of text.matchAll(COMMAND_NAME_RE)) {
              const skill = m[1]!;
              if (BUILTINS.has(skill) || seen.has(skill)) continue;
              seen.add(skill);

              calls.push({
                skill,
                timestamp: sessionTs,
                project,
                sessionId: sessionDir,
                source: this.name,
              });
            }
          }
        }
      }
    }

    return calls;
  }
}
