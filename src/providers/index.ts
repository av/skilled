import { Database } from "bun:sqlite";
import { existsSync, statSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { spawnSync } from "child_process";
import type { SkillCall } from "../models.js";
import type { Provider } from "./base.js";

const INDEX_DB = join(homedir(), ".skilled", "index.db");
const STALE_MS = 60_000;

function findIndexer(): string | null {
  const candidates = [
    join(dirname(process.execPath), "skilled-index"),
    join(dirname(process.argv[0] ?? ""), "skilled-index"),
    join(import.meta.dir, "..", "..", "index", "target", "release", "skilled-index"),
  ];

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }

  const which = spawnSync("command", ["-v", "skilled-index"], { stdio: "pipe", shell: true });
  if (which.status === 0) return which.stdout.toString().trim();

  return null;
}

function isStale(dbPath: string): boolean {
  if (!existsSync(dbPath)) return true;
  return Date.now() - statSync(dbPath).mtimeMs > STALE_MS;
}

export function refreshIndex(quiet = true, json = false, db?: string): boolean {
  const indexer = findIndexer();
  if (!indexer) return false;

  const args: string[] = [];
  if (quiet && !json) args.push("--quiet");
  if (json) args.push("--json");
  if (db) args.push("--db", db);
  const result = spawnSync(indexer, args, {
    stdio: (quiet && !json) ? "pipe" : "inherit",
    timeout: 30_000,
  });
  return result.status === 0;
}

export function ensureIndex(db?: string): boolean {
  const dbPath = db ?? INDEX_DB;
  if (!isStale(dbPath)) return true;
  return refreshIndex(true, false, db);
}

export function indexAvailable(): boolean {
  return findIndexer() !== null;
}

export function createIndexProviders(customDb?: string): Provider[] | null {
  const dbPath = customDb ?? INDEX_DB;
  if (!existsSync(dbPath)) return null;

  let db: InstanceType<typeof Database>;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch {
    return null;
  }

  try {
    const providerRows = db.query<{ name: string; available: number; calls: number }, []>(
      "SELECT name, available, calls FROM providers ORDER BY rowid",
    ).all();

    const callRows = db.query<{
      skill: string;
      timestamp_ms: number;
      project: string;
      session_id: string;
      source: string;
    }, []>("SELECT skill, timestamp_ms, project, session_id, source FROM calls").all();

    const callsBySource = new Map<string, SkillCall[]>();
    for (const row of callRows) {
      const call: SkillCall = {
        skill: row.skill,
        timestamp: new Date(row.timestamp_ms),
        project: row.project,
        sessionId: row.session_id,
        source: row.source,
      };
      let list = callsBySource.get(row.source);
      if (!list) {
        list = [];
        callsBySource.set(row.source, list);
      }
      list.push(call);
    }

    return providerRows.map((row): Provider => {
      const calls = callsBySource.get(row.name) ?? [];
      return {
        name: row.name,
        available: () => row.available === 1,
        collect: () => calls,
      };
    });
  } catch {
    return null;
  } finally {
    db.close();
  }
}
