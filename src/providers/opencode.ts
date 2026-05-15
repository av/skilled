import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { Database } from "bun:sqlite";
import type { SkillCall } from "../models.js";
import type { Provider } from "./base.js";

const DB_PATH = join(homedir(), ".local", "share", "opencode", "opencode.db");

const BUILTINS = new Set([
  "bash", "compact", "help", "model", "config", "exit", "clear",
  "status", "version", "approve", "settings", "list",
]);

export class OpenCodeProvider implements Provider {
  readonly name = "OpenCode";

  available(): boolean {
    return existsSync(DB_PATH);
  }

  collect(): SkillCall[] {
    if (!this.available()) return [];

    let db: Database;
    try {
      db = new Database(DB_PATH, { readonly: true });
    } catch {
      return [];
    }

    const calls: SkillCall[] = [];

    try {
      const rows = db.query<
        { data: string; directory: string; session_id: string },
        []
      >(`
        SELECT p.data, s.directory, p.session_id
        FROM part p
        JOIN session s ON p.session_id = s.id
        WHERE json_extract(p.data, '$.type') = 'tool'
          AND json_extract(p.data, '$.tool') = 'skill'
      `).all();

      for (const row of rows) {
        let data: any;
        try {
          data = JSON.parse(row.data);
        } catch {
          continue;
        }

        const state = data.state;
        if (!state || state.status !== "completed") continue;

        const input = state.input ?? {};
        const skill = input.name ?? "";
        if (!skill || BUILTINS.has(skill)) continue;

        const time = state.time ?? {};
        const timestamp = time.start ? new Date(time.start) : new Date(0);

        calls.push({
          skill,
          timestamp,
          project: row.directory ?? "",
          sessionId: row.session_id ?? "",
          source: this.name,
        });
      }
    } finally {
      db.close();
    }

    return calls;
  }
}
