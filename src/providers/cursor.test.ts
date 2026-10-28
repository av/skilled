import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { collectCursorCalls, parseCursorTimestamp } from "./cursor.js";

const SESSION = "11111111-2222-4333-8444-555555555555";
const PROJECT = "Users-tester-code-skilled";

function fixture(body: string): string {
  const root = mkdtempSync(join(tmpdir(), "skilled-cursor-"));
  const dir = join(root, PROJECT, "agent-transcripts", SESSION);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${SESSION}.jsonl`), body);
  return root;
}

function line(record: unknown): string {
  return JSON.stringify(record) + "\n";
}

function user(text: string) {
  return { role: "user", message: { content: [{ type: "text", text }] } };
}

function read(path: string) {
  return { type: "tool_use", name: "Read", input: { path } };
}

describe("collectCursorCalls", () => {
  test("counts a Read of skills/<name>/SKILL.md as a skill invocation", () => {
    const root = fixture(line({
      role: "assistant",
      message: { content: [read("/home/u/.cursor/skills/discipline/SKILL.md")] },
    }));
    const calls = collectCursorCalls(root);
    expect(calls.map(c => c.skill)).toEqual(["discipline"]);
    expect(calls[0]!.source).toBe("Cursor");
    expect(calls[0]!.project).toBe(PROJECT);
    expect(calls[0]!.sessionId).toBe(SESSION);
  });

  test("ignores a SKILL.md that is not under skills/", () => {
    const root = fixture(line({
      role: "assistant",
      message: { content: [read("/home/u/docs/SKILL.md")] },
    }));
    expect(collectCursorCalls(root)).toEqual([]);
  });

  test("counts a SKILL.md load at most once per transcript", () => {
    const root = fixture(line({
      role: "assistant",
      message: {
        content: [
          read("/home/u/.cursor/skills/discipline/SKILL.md"),
          read("/home/u/.agents/skills/discipline/SKILL.md"),
          read("/home/u/.cursor/skills/ponytail/SKILL.md"),
        ],
      },
    }));
    expect(collectCursorCalls(root).map(c => c.skill)).toEqual(["discipline", "ponytail"]);
  });

  test("uses the preceding user timestamp", () => {
    expect(parseCursorTimestamp("<timestamp>Tuesday, Oct 27, 2026, 10:39 PM (UTC+8)</timestamp>")!.getTime())
      .toBe(1793111940000);
    expect(parseCursorTimestamp("<timestamp>Thursday, Jan 1, 2026, 12:00 AM (UTC-5)</timestamp>")!.getTime())
      .toBe(1767243600000);
    expect(parseCursorTimestamp("<timestamp>Thursday, Jan 1, 2026, 12:00 PM (UTC-5)</timestamp>")!.getTime())
      .toBe(1767286800000);

    const root = fixture(
      line(user("<timestamp>Tuesday, Oct 27, 2026, 10:39 PM (UTC+8)</timestamp>"))
      + line({ role: "assistant", message: { content: [read("/home/u/.cursor/skills/discipline/SKILL.md")] } }),
    );
    expect(collectCursorCalls(root)[0]!.timestamp.getTime()).toBe(1793111940000);
  });

  test("falls back to file mtime when the user timestamp tag is missing", () => {
    const root = fixture(line({
      role: "assistant",
      message: { content: [read("/home/u/.cursor/skills/discipline/SKILL.md")] },
    }));
    const file = join(root, PROJECT, "agent-transcripts", SESSION, `${SESSION}.jsonl`);
    const when = new Date("2026-01-02T03:04:05.000Z");
    utimesSync(file, when, when);
    expect(collectCursorCalls(root)[0]!.timestamp.getTime()).toBe(when.getTime());
  });
});
