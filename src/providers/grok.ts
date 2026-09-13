import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { SkillCall } from "../models.js";
import type { Provider } from "./base.js";

const SESSIONS_DIR = join(homedir(), ".grok", "sessions");
const SOURCE = "Grok CLI";

const BUILTINS = new Set([
  "compact", "always-approve", "context", "plugins", "reload-plugins",
  "session-info", "imagine", "imagine-video", "feedback", "loop",
  "help", "memory", "clear", "exit",
]);

const COMMAND_NAME_RE = /<command-name>([^<]+)<\/command-name>/g;
const SKILL_MD_RE = /(?:^|\/)skills\/([^/]+)\/SKILL\.md$/i;

/** Extract millisecond timestamp from a UUIDv7 string (first 48 bits). */
function uuidv7ToMs(uuid: string): number {
  const hex = uuid.replace(/-/g, "").slice(0, 12);
  return parseInt(hex, 16) || 0;
}

/**
 * If `filePath` is a skill playbook (`…/skills/<name>/SKILL.md`), return `<name>`.
 * Returns null for any other path, including files inside a skill that are not SKILL.md.
 */
export function skillNameFromSkillMdPath(filePath: string): string | null {
  if (!filePath) return null;
  const normalized = filePath.replace(/\\/g, "/");
  const match = normalized.match(SKILL_MD_RE);
  return match ? match[1]! : null;
}

function parseToolArgs(args: unknown): Record<string, unknown> {
  if (typeof args === "string") {
    try {
      const parsed = JSON.parse(args);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
    return {};
  }
  if (args && typeof args === "object") return args as Record<string, unknown>;
  return {};
}

function grokToolName(update: any): string {
  return update?._meta?.["x.ai/tool"]?.name ?? update?.title ?? "";
}

function grokToolPath(update: any): string {
  const raw = update?.rawInput ?? {};
  const metaPath = update?._meta?.["x.ai/tool"]?.input?.path;
  return String(raw.target_file || raw.path || metaPath || "");
}

function recordTimestamp(record: any): Date {
  const rawTs = record.timestamp ? new Date(record.timestamp * 1000) : new Date(0);
  return Number.isFinite(rawTs.getTime()) ? rawTs : new Date(0);
}

function pushSkill(
  calls: SkillCall[],
  seen: Set<string>,
  skill: string,
  timestamp: Date,
  project: string,
  sessionId: string,
): void {
  if (!skill || BUILTINS.has(skill) || seen.has(skill)) return;
  seen.add(skill);
  calls.push({ skill, timestamp, project, sessionId, source: SOURCE });
}

/** Collect Grok skill calls from a sessions root (testable; production uses ~/.grok/sessions). */
export function collectGrokCalls(sessionsDir: string): SkillCall[] {
  const calls: SkillCall[] = [];

  let projectDirs: string[];
  try {
    projectDirs = readdirSync(sessionsDir).filter(e => e.startsWith("%2F"));
  } catch {
    return [];
  }

  for (const projEntry of projectDirs) {
    let project: string;
    try {
      project = decodeURIComponent(projEntry);
    } catch {
      project = projEntry;
    }
    const projDir = join(sessionsDir, projEntry);

    let sessionDirs: string[];
    try {
      sessionDirs = readdirSync(projDir, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name);
    } catch {
      continue;
    }

    for (const sessionDir of sessionDirs) {
      const seen = new Set<string>();

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
          if (!update) continue;

          const sessionId = params.sessionId ?? sessionDir;
          const ts = recordTimestamp(record);

          if (update.sessionUpdate === "user_message_chunk") {
            const msgContent = update.content;
            if (!msgContent || msgContent.type !== "text") continue;
            const text: string = msgContent.text ?? "";
            COMMAND_NAME_RE.lastIndex = 0;
            for (const m of text.matchAll(COMMAND_NAME_RE)) {
              // Slash commands are explicit user invocations: count each one.
              const skill = m[1]!;
              if (!skill || BUILTINS.has(skill)) continue;
              seen.add(skill);
              calls.push({ skill, timestamp: ts, project, sessionId, source: SOURCE });
            }
            continue;
          }

          // Grok Build loads skills by reading SKILL.md. Count the initial
          // tool_call only — tool_call_update repeats the same invocation.
          if (update.sessionUpdate === "tool_call") {
            if (grokToolName(update) !== "read_file") continue;
            const skill = skillNameFromSkillMdPath(grokToolPath(update));
            if (skill) pushSkill(calls, seen, skill, ts, project, sessionId);
          }
        }
      }

      const chatPath = join(projDir, sessionDir, "chat_history.jsonl");
      if (existsSync(chatPath)) {
        let content: string;
        try {
          content = readFileSync(chatPath, "utf-8");
        } catch {
          content = "";
        }

        const sessionTs = new Date(uuidv7ToMs(sessionDir));

        for (const line of content.split("\n")) {
          if (!line.trim()) continue;
          const maybeCommand = line.includes("command-name");
          const maybeSkillMd = line.includes("SKILL.md");
          if (!maybeCommand && !maybeSkillMd) continue;

          let record: any;
          try {
            record = JSON.parse(line);
          } catch {
            continue;
          }

          if (record.type === "user" && maybeCommand) {
            const text: string = typeof record.content === "string"
              ? record.content
              : Array.isArray(record.content)
                ? record.content.map((p: any) => p?.text ?? "").join("")
                : "";

            if (text.includes("<background_context>")) continue;

            COMMAND_NAME_RE.lastIndex = 0;
            for (const m of text.matchAll(COMMAND_NAME_RE)) {
              pushSkill(calls, seen, m[1]!, sessionTs, project, sessionDir);
            }
            continue;
          }

          if (record.type === "assistant" && maybeSkillMd && Array.isArray(record.tool_calls)) {
            for (const tc of record.tool_calls) {
              if (!tc || tc.name !== "read_file") continue;
              const args = parseToolArgs(tc.arguments);
              const path = String(args.target_file ?? args.path ?? "");
              const skill = skillNameFromSkillMdPath(path);
              if (skill) pushSkill(calls, seen, skill, sessionTs, project, sessionDir);
            }
          }
        }
      }
    }
  }

  return calls;
}

export class GrokProvider implements Provider {
  readonly name = SOURCE;

  available(): boolean {
    return existsSync(SESSIONS_DIR);
  }

  collect(): SkillCall[] {
    if (!this.available()) return [];
    return collectGrokCalls(SESSIONS_DIR);
  }
}
