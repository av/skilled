import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { SkillCall } from "../models.js";
import type { Provider } from "./base.js";
import { skillNameFromSkillMdPath } from "./grok.js";

const SOURCE = "Cursor";
const PROJECTS_DIR = join(homedir(), ".cursor", "projects");

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** `<timestamp>Tuesday, Oct 27, 2026, 10:39 PM (UTC+8)</timestamp>` */
const TS_RE = /<timestamp>[A-Za-z]+,\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4}),\s+(\d{1,2}):(\d{2})\s*(AM|PM)\s*\(UTC([+-]\d{1,2})(?::(\d{2}))?\)\s*<\/timestamp>/i;

export function parseCursorTimestamp(text: string): Date | null {
  const m = text.match(TS_RE);
  if (!m) return null;
  const month = MONTHS[m[1]!.toLowerCase()];
  if (month === undefined) return null;
  const day = Number(m[2]);
  const year = Number(m[3]);
  let hour = Number(m[4]);
  const minute = Number(m[5]);
  const ampm = m[6]!.toUpperCase();
  const offH = Number(m[7]);
  const offM = Number(m[8] ?? "0");
  if (ampm === "AM") {
    if (hour === 12) hour = 0;
  } else if (hour !== 12) {
    hour += 12;
  }
  const offsetMin = offH * 60 + Math.sign(offH) * offM;
  const utc = Date.UTC(year, month, day, hour, minute) - offsetMin * 60_000;
  const date = new Date(utc);
  return Number.isFinite(date.getTime()) ? date : null;
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part: { text?: string }) => part?.text ?? "").join("");
}

/** Collect Cursor skill calls from a projects root (testable; production uses ~/.cursor/projects). */
export function collectCursorCalls(projectsDir: string): SkillCall[] {
  const calls: SkillCall[] = [];
  let projectDirs: string[];
  try {
    projectDirs = readdirSync(projectsDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
  } catch {
    return [];
  }

  for (const project of projectDirs) {
    const transcripts = join(projectsDir, project, "agent-transcripts");
    let sessionDirs: string[];
    try {
      sessionDirs = readdirSync(transcripts, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name);
    } catch {
      continue;
    }

    for (const sessionId of sessionDirs) {
      const file = join(transcripts, sessionId, `${sessionId}.jsonl`);
      if (!existsSync(file)) continue;
      let content: string;
      try {
        content = readFileSync(file, "utf-8");
      } catch {
        continue;
      }
      // Using file mtime instead of <timestamp> when the user line has no <timestamp> tag.
      // Per-read times need a Cursor field that does not exist yet.
      let ts = new Date(0);
      try {
        ts = new Date(statSync(file).mtimeMs);
      } catch { /* keep epoch */ }

      const seen = new Set<string>();
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        const lower = line.toLowerCase();
        if (!lower.includes("skill.md") && !line.includes("<timestamp>")) continue;

        let record: any;
        try {
          record = JSON.parse(line);
        } catch {
          continue;
        }

        const contentBlocks = record?.message?.content;
        if (record.role === "user") {
          const parsed = parseCursorTimestamp(messageText(contentBlocks));
          if (parsed) ts = parsed;
          continue;
        }
        if (record.role !== "assistant" || !Array.isArray(contentBlocks)) continue;

        for (const block of contentBlocks) {
          if (!block || block.type !== "tool_use" || block.name !== "Read") continue;
          const path = String(block.input?.path ?? block.input?.file_path ?? "");
          const skill = skillNameFromSkillMdPath(path);
          // One count per skill per transcript
          if (!skill || seen.has(skill)) continue;
          seen.add(skill);
          calls.push({ skill, timestamp: ts, project, sessionId, source: SOURCE });
        }
      }
    }
  }

  return calls;
}

export class CursorProvider implements Provider {
  readonly name = SOURCE;

  available(): boolean {
    return existsSync(PROJECTS_DIR);
  }

  collect(): SkillCall[] {
    if (!this.available()) return [];
    return collectCursorCalls(PROJECTS_DIR);
  }
}
