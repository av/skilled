use std::fs;
use std::path::Path;
use std::time::Instant;

use rusqlite::Connection;

use crate::model::{ProviderResult, SkillCall};

/// Index is considered fresh for this long, matching the TUI's `ensureIndex`.
pub const STALE_MS: u128 = 60_000;

pub struct IndexStats {
    pub total_calls: usize,
    pub elapsed_ms: u128,
}

pub fn write_index(db_path: &Path, results: &[ProviderResult]) -> Result<IndexStats, String> {
    let start = Instant::now();

    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create dir: {e}"))?;
    }

    let tmp_path = db_path.with_extension("db.tmp");
    let _ = fs::remove_file(&tmp_path);

    let mut conn = Connection::open(&tmp_path).map_err(|e| format!("open db: {e}"))?;

    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;",
    )
    .map_err(|e| format!("pragma: {e}"))?;

    let tx = conn.transaction().map_err(|e| format!("begin: {e}"))?;

    tx.execute_batch(
        "CREATE TABLE calls (
             skill TEXT NOT NULL,
             timestamp_ms INTEGER NOT NULL,
             project TEXT NOT NULL,
             session_id TEXT NOT NULL,
             source TEXT NOT NULL,
             file TEXT NOT NULL DEFAULT ''
         );

         CREATE TABLE providers (
             name TEXT NOT NULL,
             available INTEGER NOT NULL DEFAULT 0,
             calls INTEGER NOT NULL DEFAULT 0
         );

         CREATE TABLE meta (
             key TEXT NOT NULL PRIMARY KEY,
             value TEXT NOT NULL
         );",
    )
    .map_err(|e| format!("create tables: {e}"))?;

    let mut total_calls = 0usize;

    {
        let mut insert_call = tx
            .prepare(
                "INSERT INTO calls (skill, timestamp_ms, project, session_id, source, file)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            )
            .map_err(|e| format!("prepare insert: {e}"))?;

        let mut insert_provider = tx
            .prepare("INSERT INTO providers (name, available, calls) VALUES (?1, ?2, ?3)")
            .map_err(|e| format!("prepare provider: {e}"))?;

        for result in results {
            insert_provider
                .execute(rusqlite::params![
                    result.name,
                    result.available as i32,
                    result.calls.len() as i64,
                ])
                .map_err(|e| format!("insert provider: {e}"))?;

            for call in &result.calls {
                insert_call
                    .execute(rusqlite::params![
                        call.skill,
                        call.timestamp_ms,
                        call.project,
                        call.session_id,
                        call.source,
                        call.file,
                    ])
                    .map_err(|e| format!("insert call: {e}"))?;
            }

            total_calls += result.calls.len();
        }
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    tx.execute(
        "INSERT INTO meta (key, value) VALUES ('indexed_at', ?1), ('version', ?2)",
        rusqlite::params![now.to_string(), crate::VERSION],
    )
    .map_err(|e| format!("insert meta: {e}"))?;

    tx.execute_batch(
        "CREATE INDEX idx_calls_skill ON calls(skill);
         CREATE INDEX idx_calls_source ON calls(source);
         CREATE INDEX idx_calls_ts ON calls(timestamp_ms);",
    )
    .map_err(|e| format!("create indexes: {e}"))?;

    tx.commit().map_err(|e| format!("commit: {e}"))?;
    drop(conn);

    fs::rename(&tmp_path, db_path).map_err(|e| format!("rename: {e}"))?;
    // Clean up WAL/SHM files from the temp DB
    // Note: SQLite names these as "<dbpath>-wal" and "<dbpath>-shm"
    let tmp_str = tmp_path.display().to_string();
    let _ = fs::remove_file(format!("{tmp_str}-wal"));
    let _ = fs::remove_file(format!("{tmp_str}-shm"));

    Ok(IndexStats {
        total_calls,
        elapsed_ms: start.elapsed().as_millis(),
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderRow {
    pub name: String,
    pub available: bool,
    pub calls: usize,
}

/// Everything the desktop needs from one index file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndexSnapshot {
    pub calls: Vec<SkillCall>,
    pub providers: Vec<ProviderRow>,
    /// Unix seconds recorded by the indexer, if present.
    pub indexed_at: Option<u64>,
    /// Indexer version that wrote the file, if present.
    pub version: Option<String>,
}

/// True when the index does not exist or is older than [`STALE_MS`], the same
/// rule `ensureIndex()` uses in the TUI.
pub fn is_stale(db_path: &Path) -> bool {
    match fs::metadata(db_path).and_then(|m| m.modified()) {
        Ok(modified) => match std::time::SystemTime::now().duration_since(modified) {
            Ok(age) => age.as_millis() > STALE_MS,
            Err(_) => false,
        },
        Err(_) => true,
    }
}

/// Read an index written by [`write_index`]. Indexes written by older
/// versions (no `file` column, no `version` meta) are read with empty values.
pub fn read_index(db_path: &Path) -> Result<IndexSnapshot, String> {
    let conn = Connection::open_with_flags(
        db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("open index: {e}"))?;

    let has_file: bool = conn
        .prepare("SELECT 1 FROM pragma_table_info('calls') WHERE name = 'file'")
        .and_then(|mut s| s.exists([]))
        .map_err(|e| format!("inspect schema: {e}"))?;

    let sql = if has_file {
        "SELECT skill, timestamp_ms, project, session_id, source, file FROM calls ORDER BY timestamp_ms DESC"
    } else {
        "SELECT skill, timestamp_ms, project, session_id, source, '' FROM calls ORDER BY timestamp_ms DESC"
    };
    let mut stmt = conn.prepare(sql).map_err(|e| format!("prepare calls: {e}"))?;
    let calls = stmt
        .query_map([], |r| {
            Ok(SkillCall {
                skill: r.get(0)?,
                timestamp_ms: r.get(1)?,
                project: r.get(2)?,
                session_id: r.get(3)?,
                source: r.get(4)?,
                file: r.get(5)?,
            })
        })
        .map_err(|e| format!("query calls: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("read calls: {e}"))?;

    let mut stmt = conn
        .prepare("SELECT name, available, calls FROM providers ORDER BY rowid")
        .map_err(|e| format!("prepare providers: {e}"))?;
    let providers = stmt
        .query_map([], |r| {
            Ok(ProviderRow {
                name: r.get(0)?,
                available: r.get::<_, i64>(1)? == 1,
                calls: r.get::<_, i64>(2)?.max(0) as usize,
            })
        })
        .map_err(|e| format!("query providers: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("read providers: {e}"))?;

    let meta = |key: &str| -> Option<String> {
        conn.query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get::<_, String>(0))
            .ok()
    };
    let indexed_at = meta("indexed_at").and_then(|v| v.parse().ok());
    let version = meta("version");

    Ok(IndexSnapshot { calls, providers, indexed_at, version })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Vec<ProviderResult> {
        vec![
            ProviderResult {
                name: "Claude Code".into(),
                available: true,
                calls: vec![
                    SkillCall { skill: "review".into(), timestamp_ms: 1_700_000_000_000, project: "/p/a".into(), session_id: "s1".into(), source: "Claude Code".into(), file: "/h/.claude/projects/a/s1.jsonl".into() },
                    SkillCall { skill: "commit".into(), timestamp_ms: 1_700_000_100_000, project: "/p/b".into(), session_id: "s2".into(), source: "Claude Code".into(), file: "/h/.claude/history.jsonl".into() },
                ],
            },
            ProviderResult { name: "Codex CLI".into(), available: false, calls: vec![] },
        ]
    }

    #[test]
    fn read_index_round_trips_write_index() {
        let dir = std::env::temp_dir().join(format!("skilled-index-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let db = dir.join("index.db");
        let stats = write_index(&db, &sample()).unwrap();
        assert_eq!(stats.total_calls, 2);

        let snap = read_index(&db).unwrap();
        assert_eq!(snap.calls.len(), 2);
        assert_eq!(snap.calls[0].skill, "commit", "newest first");
        assert_eq!(snap.calls[1].file, "/h/.claude/projects/a/s1.jsonl");
        assert_eq!(snap.providers.len(), 2);
        assert!(snap.providers[0].available);
        assert!(!snap.providers[1].available);
        assert!(snap.indexed_at.is_some());
        assert_eq!(snap.version.as_deref(), Some(crate::VERSION));
        assert!(!is_stale(&db));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_index_tolerates_legacy_schema_without_file_column() {
        let dir = std::env::temp_dir().join(format!("skilled-index-legacy-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let db = dir.join("index.db");
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch(
            "CREATE TABLE calls (skill TEXT NOT NULL, timestamp_ms INTEGER NOT NULL, project TEXT NOT NULL, session_id TEXT NOT NULL, source TEXT NOT NULL);
             CREATE TABLE providers (name TEXT NOT NULL, available INTEGER NOT NULL DEFAULT 0, calls INTEGER NOT NULL DEFAULT 0);
             CREATE TABLE meta (key TEXT NOT NULL PRIMARY KEY, value TEXT NOT NULL);
             INSERT INTO calls VALUES ('x', 1, '/p', 's', 'Grok CLI');
             INSERT INTO providers VALUES ('Grok CLI', 1, 1);",
        )
        .unwrap();
        drop(conn);
        let snap = read_index(&db).unwrap();
        assert_eq!(snap.calls.len(), 1);
        assert_eq!(snap.calls[0].file, "");
        assert_eq!(snap.indexed_at, None);
        assert!(is_stale(&dir.join("missing.db")));
        let _ = fs::remove_dir_all(&dir);
    }
}
