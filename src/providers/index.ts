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
    join(dirname(process.argv[0] ?? ""), "skilled-index"),
    join(import.meta.dir, "..", "..", "index", "target", "release", "skilled-index"),
  ];

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }

  const which = spawnSync("which", ["skilled-index"], { stdio: "pipe" });
  if (which.status === 0) return which.stdout.toString().trim();

  return null;
}

function isStale(): boolean {
  if (!existsSync(INDEX_DB)) return true;
  return Date.now() - statSync(INDEX_DB).mtimeMs > STALE_MS;
}

export function refreshIndex(quiet = true): boolean {
  const indexer = findIndexer();
  if (!indexer) return false;

  const args = quiet ? ["--quiet"] : [];
  const result = spawnSync(indexer, args, {
    stdio: quiet ? "pipe" : "inherit",
    timeout: 30_000,
  });
  return result.status === 0;
}

export function ensureIndex(): boolean {
  if (!isStale()) return true;
  return refreshIndex();
}

export function indexAvailable(): boolean {
  return findIndexer() !== null;
}

export function createIndexProviders(): Provider[] | null {
  if (!existsSync(INDEX_DB)) return null;

  let db: InstanceType<typeof Database>;
  try {
    db = new Database(INDEX_DB, { readonly: true });
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
