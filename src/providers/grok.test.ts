import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { collectGrokCalls, skillNameFromSkillMdPath } from "./grok.js";

const SESSION = "01a09a3f-dcf8-72d0-89dd-78d4a84d1d35";
const PROJECT_ENC = "%2Ftmp%2Fdemo";

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "skilled-grok-"));
  const sessionDir = join(root, PROJECT_ENC, SESSION);
  mkdirSync(sessionDir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(sessionDir, name), body);
  }
  return root;
}

describe("skillNameFromSkillMdPath", () => {
  test("Grok skill name for a SKILL.md load is the directory containing the file", () => {
    expect(skillNameFromSkillMdPath("/home/u/.agents/skills/discipline/SKILL.md")).toBe("discipline");
    expect(skillNameFromSkillMdPath("/repo/.agents/skills/use-coding-agents/SKILL.md")).toBe("use-coding-agents");
    expect(skillNameFromSkillMdPath("/home/u/.grok/bundled/skills/imagine/SKILL.md")).toBe("imagine");
    expect(skillNameFromSkillMdPath("C:\\Users\\u\\.agents\\skills\\review\\SKILL.md")).toBe("review");
  });

  test("non-playbook paths are not skills", () => {
    expect(skillNameFromSkillMdPath("/home/u/.agents/skills/discipline/references/foo.md")).toBeNull();
    expect(skillNameFromSkillMdPath("/home/u/code/lifeos/USER.md")).toBeNull();
    expect(skillNameFromSkillMdPath("/home/u/docs/SKILL.md")).toBeNull();
    expect(skillNameFromSkillMdPath("")).toBeNull();
  });
});

describe("collectGrokCalls", () => {
  test("counts a read_file of skills/<name>/SKILL.md as a skill invocation", () => {
    const root = fixture({
      "chat_history.jsonl": JSON.stringify({
        type: "assistant",
        tool_calls: [{
          id: "call-1",
          name: "read_file",
          arguments: JSON.stringify({
            target_file: "/home/u/.agents/skills/discipline/SKILL.md",
          }),
        }],
      }) + "\n",
    });
    const calls = collectGrokCalls(root);
    expect(calls.map(c => c.skill)).toEqual(["discipline"]);
    expect(calls[0]!.source).toBe("Grok CLI");
    expect(calls[0]!.project).toBe("/tmp/demo");
    expect(calls[0]!.sessionId).toBe(SESSION);
  });

  test("counts SKILL.md loads from updates.jsonl tool_call events", () => {
    const root = fixture({
      "updates.jsonl": JSON.stringify({
        timestamp: 1789294328,
        params: {
          sessionId: SESSION,
          update: {
            sessionUpdate: "tool_call",
            title: "read_file",
            rawInput: { target_file: "/repo/.agents/skills/gauntlet/SKILL.md" },
            _meta: { "x.ai/tool": { name: "read_file" } },
          },
        },
      }) + "\n",
    });
    const calls = collectGrokCalls(root);
    expect(calls.map(c => c.skill)).toEqual(["gauntlet"]);
    expect(calls[0]!.timestamp.getTime()).toBe(1789294328 * 1000);
  });

  test("ignores tool_call_update events so they do not duplicate tool_call", () => {
    const root = fixture({
      "updates.jsonl": [
        {
          timestamp: 100,
          params: {
            sessionId: SESSION,
            update: {
              sessionUpdate: "tool_call",
              title: "read_file",
              rawInput: { target_file: "/s/skills/review/SKILL.md" },
              _meta: { "x.ai/tool": { name: "read_file" } },
            },
          },
        },
        {
          timestamp: 101,
          params: {
            sessionId: SESSION,
            update: {
              sessionUpdate: "tool_call_update",
              title: "Read `/s/skills/review/SKILL.md`",
              rawInput: { target_file: "/s/skills/review/SKILL.md" },
              _meta: { "x.ai/tool": { name: "read_file" } },
            },
          },
        },
      ].map(o => JSON.stringify(o)).join("\n") + "\n",
    });
    expect(collectGrokCalls(root).map(c => c.skill)).toEqual(["review"]);
  });

  test("counts a SKILL.md load at most once per session even if re-read from project and global copies", () => {
    const root = fixture({
      "chat_history.jsonl": [
        {
          type: "assistant",
          tool_calls: [{
            name: "read_file",
            arguments: JSON.stringify({ target_file: "/repo/.agents/skills/overnight/SKILL.md" }),
          }],
        },
        {
          type: "assistant",
          tool_calls: [{
            name: "read_file",
            arguments: JSON.stringify({ target_file: "/home/u/.agents/skills/overnight/SKILL.md" }),
          }],
        },
        {
          type: "assistant",
          tool_calls: [{
            name: "read_file",
            arguments: JSON.stringify({ target_file: "/repo/.agents/skills/overnight/SKILL.md", limit: 50 }),
          }],
        },
      ].map(o => JSON.stringify(o)).join("\n") + "\n",
    });
    expect(collectGrokCalls(root).map(c => c.skill)).toEqual(["overnight"]);
  });

  test("still counts slash-command invocations from <command-name> tags in user messages", () => {
    const root = fixture({
      "chat_history.jsonl": JSON.stringify({
        type: "user",
        content: "<command-name>bugbash</command-name>",
      }) + "\n",
    });
    expect(collectGrokCalls(root).map(c => c.skill)).toEqual(["bugbash"]);
  });

  test("does not count builtin slash commands loaded via SKILL.md", () => {
    const root = fixture({
      "chat_history.jsonl": JSON.stringify({
        type: "assistant",
        tool_calls: [{
          name: "read_file",
          arguments: JSON.stringify({ target_file: "/home/u/.grok/bundled/skills/help/SKILL.md" }),
        }],
      }) + "\n",
    });
    expect(collectGrokCalls(root)).toEqual([]);
  });

  test("does not count grep or non-read_file tools that mention SKILL.md", () => {
    const root = fixture({
      "chat_history.jsonl": JSON.stringify({
        type: "assistant",
        tool_calls: [{
          name: "grep",
          arguments: JSON.stringify({
            pattern: "foo",
            path: "/home/u/code",
            glob: "**/SKILL.md",
          }),
        }],
      }) + "\n" + JSON.stringify({
        type: "assistant",
        tool_calls: [{
          name: "read_file",
          arguments: JSON.stringify({ target_file: "/home/u/src/providers/grok.ts" }),
        }],
      }) + "\n",
      "updates.jsonl": JSON.stringify({
        timestamp: 1,
        params: {
          update: {
            sessionUpdate: "tool_call",
            title: "grep",
            rawInput: { path: "/s/skills/review/SKILL.md" },
            _meta: { "x.ai/tool": { name: "grep" } },
          },
        },
      }) + "\n",
    });
    expect(collectGrokCalls(root)).toEqual([]);
  });

  test("does not count background_context replay of slash commands", () => {
    const root = fixture({
      "chat_history.jsonl": JSON.stringify({
        type: "user",
        content: "<background_context> earlier <command-name>bugbash</command-name></background_context>",
      }) + "\n",
    });
    expect(collectGrokCalls(root)).toEqual([]);
  });
});
