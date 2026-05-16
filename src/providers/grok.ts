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

      // Walk session subdirectories for updates.jsonl
      let sessionDirs: string[];
      try {
        sessionDirs = readdirSync(projDir, { withFileTypes: true })
          .filter(e => e.isDirectory())
          .map(e => e.name);
      } catch {
        continue;
      }

      for (const sessionDir of sessionDirs) {
        const updatesPath = join(projDir, sessionDir, "updates.jsonl");
        if (!existsSync(updatesPath)) continue;

        let content: string;
        try {
          content = readFileSync(updatesPath, "utf-8");
        } catch {
          continue;
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
    }

    return calls;
  }
}
