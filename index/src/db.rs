use std::fs;
use std::path::Path;
use std::time::Instant;

use rusqlite::Connection;

use crate::model::ProviderResult;

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
             source TEXT NOT NULL
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
                "INSERT INTO calls (skill, timestamp_ms, project, session_id, source)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
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
        "INSERT INTO meta (key, value) VALUES ('indexed_at', ?1)",
        rusqlite::params![now.to_string()],
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
    let _ = fs::remove_file(tmp_path.with_extension("db.tmp-wal"));
    let _ = fs::remove_file(tmp_path.with_extension("db.tmp-shm"));

    Ok(IndexStats {
        total_calls,
        elapsed_ms: start.elapsed().as_millis(),
    })
}
