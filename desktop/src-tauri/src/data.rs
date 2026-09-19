//! Data path. Mirrors `getProviders()` in `src/main.ts`:
//!
//! 1. `ReaderMode::Index` — run the Rust indexer in-process (same crate the
//!    `skilled-index` binary is built from), write `~/.skilled/index.db`, read
//!    it back. A fresh index (< 60 s) is reused instead of re-parsed.
//! 2. If the index fails, or `ReaderMode::Cli` is chosen, run the installed
//!    `skilled` CLI with `--no-index --json` so the TypeScript providers do the
//!    reading. No parser is duplicated here.

use serde::{Deserialize, Serialize};
use skilled_index::{all_providers_with, locations, read_index, write_index, ProviderPaths};
use std::path::Path;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::settings::{ReaderMode, Settings};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WireCall {
    pub skill: String,
    pub timestamp_ms: i64,
    pub project: String,
    pub session_id: String,
    pub source: String,
    pub file: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    pub name: String,
    pub slug: String,
    pub available: bool,
    pub calls: usize,
    pub path: String,
    pub overridden: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Reader {
    /// Rust indexer, linked in-process.
    RustIndex,
    /// TypeScript providers via the installed `skilled` CLI.
    TsCli,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub calls: Vec<WireCall>,
    pub providers: Vec<ProviderInfo>,
    pub reader: Reader,
    /// Unix ms when the data was (re)indexed.
    pub indexed_at_ms: i64,
    /// Whether this call re-ran the parsers or reused a fresh index.
    pub reindexed: bool,
    pub db_path: String,
    pub index_version: Option<String>,
    /// Non-fatal problems (e.g. index failed, fell back to CLI).
    pub warnings: Vec<String>,
    pub elapsed_ms: u128,
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn provider_infos(home: &str, paths: &ProviderPaths, rows: &[(String, bool, usize)]) -> Vec<ProviderInfo> {
    locations(home, paths)
        .into_iter()
        .map(|loc| {
            let row = rows.iter().find(|(n, _, _)| n == loc.name);
            ProviderInfo {
                name: loc.name.to_string(),
                slug: loc.slug.to_string(),
                available: row.map(|r| r.1).unwrap_or(false),
                calls: row.map(|r| r.2).unwrap_or(0),
                path: loc.path,
                overridden: loc.overridden,
            }
        })
        .collect()
}

/// Read through the Rust index. `force` re-parses even when the index is fresh.
pub fn read_via_index(settings: &Settings, home: &str, force: bool) -> Result<Snapshot, String> {
    let start = std::time::Instant::now();
    let db = settings.db_path(home);
    let paths = settings.paths.to_provider_paths();
    // Overridden paths are not what the TUI indexed, so always re-parse then.
    let must_index = force || paths != ProviderPaths::default() || skilled_index::db::is_stale(&db);
    if must_index {
        let results = all_providers_with(home, &paths, false);
        write_index(&db, &results)?;
    }
    let snap = read_index(&db)?;
    let rows: Vec<(String, bool, usize)> = snap.providers.iter().map(|p| (p.name.clone(), p.available, p.calls)).collect();
    Ok(Snapshot {
        calls: snap
            .calls
            .into_iter()
            .map(|c| WireCall { skill: c.skill, timestamp_ms: c.timestamp_ms, project: c.project, session_id: c.session_id, source: c.source, file: c.file })
            .collect(),
        providers: provider_infos(home, &paths, &rows),
        reader: Reader::RustIndex,
        indexed_at_ms: snap.indexed_at.map(|s| s as i64 * 1000).unwrap_or_else(now_ms),
        reindexed: must_index,
        db_path: db.display().to_string(),
        index_version: snap.version,
        warnings: vec![],
        elapsed_ms: start.elapsed().as_millis(),
    })
}

#[derive(Deserialize)]
struct CliCall {
    skill: String,
    timestamp: String,
    project: String,
    #[serde(rename = "sessionId")]
    session_id: String,
    source: String,
}

#[derive(Deserialize)]
struct CliProvider {
    name: String,
    available: bool,
    calls: usize,
}

fn find_cli() -> Option<String> {
    let name = if cfg!(windows) { "skilled.exe" } else { "skilled" };
    if let Ok(path) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path) {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate.display().to_string());
            }
        }
    }
    let home = skilled_index::home_dir();
    let local = Path::new(&home).join(".local").join("bin").join(name);
    local.is_file().then(|| local.display().to_string())
}

/// True when a `skilled` CLI can be found for the TypeScript fallback.
pub fn cli_available() -> bool {
    find_cli().is_some()
}

fn run_cli(cli: &str, args: &[&str]) -> Result<String, String> {
    let out = Command::new(cli)
        .args(args)
        .env("NO_COLOR", "1")
        .output()
        .map_err(|e| format!("could not run {cli}: {e}"))?;
    if !out.status.success() {
        return Err(format!("{cli} {} failed: {}", args.join(" "), String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Read through the TypeScript providers (`skilled calls --no-index --json`).
pub fn read_via_cli(settings: &Settings, home: &str) -> Result<Snapshot, String> {
    let start = std::time::Instant::now();
    let cli = find_cli().ok_or_else(|| {
        "The `skilled` CLI is not installed, so the TypeScript providers are unavailable. Install it (npm i -g @avcodes/skilled) or switch the reader back to the Rust index.".to_string()
    })?;
    let calls_json = run_cli(&cli, &["calls", "--no-index", "--json"])?;
    let providers_json = run_cli(&cli, &["providers", "--no-index", "--json"])?;
    let calls: Vec<CliCall> = serde_json::from_str(&calls_json).map_err(|e| format!("parse calls: {e}"))?;
    let providers: Vec<CliProvider> = serde_json::from_str(&providers_json).map_err(|e| format!("parse providers: {e}"))?;
    let rows: Vec<(String, bool, usize)> = providers.iter().map(|p| (p.name.clone(), p.available, p.calls)).collect();
    let paths = settings.paths.to_provider_paths();
    let mut warnings = vec![];
    if paths != ProviderPaths::default() {
        warnings.push("Path overrides only apply to the Rust index reader; the CLI auto-detects locations.".into());
    }
    let mut calls: Vec<WireCall> = calls
        .into_iter()
        .map(|c| WireCall {
            skill: c.skill,
            timestamp_ms: parse_iso_ms(&c.timestamp),
            project: c.project,
            session_id: c.session_id,
            source: c.source,
            file: String::new(),
        })
        .collect();
    calls.sort_by(|a, b| b.timestamp_ms.cmp(&a.timestamp_ms));
    Ok(Snapshot {
        calls,
        providers: provider_infos(home, &paths, &rows),
        reader: Reader::TsCli,
        indexed_at_ms: now_ms(),
        reindexed: true,
        db_path: String::new(),
        index_version: None,
        warnings,
        elapsed_ms: start.elapsed().as_millis(),
    })
}

fn parse_iso_ms(s: &str) -> i64 {
    s.parse::<i64>().ok().or_else(|| skilled_index::providers::claude_code::parse_iso_ms(s)).unwrap_or(0)
}

/// Entry point used by the Tauri command: honours the reader mode and falls
/// back from the index to the CLI, recording why.
pub fn load(settings: &Settings, home: &str, force: bool) -> Result<Snapshot, String> {
    match settings.reader_mode {
        ReaderMode::Cli => read_via_cli(settings, home),
        ReaderMode::Index => match read_via_index(settings, home, force) {
            Ok(s) => Ok(s),
            Err(index_err) => match read_via_cli(settings, home) {
                Ok(mut s) => {
                    s.warnings.insert(0, format!("Rust index failed ({index_err}); showing data from the skilled CLI instead."));
                    Ok(s)
                }
                Err(cli_err) => Err(format!("{index_err}\nFallback also failed: {cli_err}")),
            },
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::PathOverrides;

    fn fixture_home() -> String {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/home");
        root.canonicalize().unwrap().display().to_string()
    }

    #[test]
    fn index_reader_uses_fixture_home_and_records_files() {
        let home = fixture_home();
        let dir = std::env::temp_dir().join(format!("skilled-desktop-data-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let settings = Settings { db_path: dir.join("index.db").display().to_string(), ..Default::default() };
        let snap = read_via_index(&settings, &home, true).unwrap();
        assert_eq!(snap.reader, Reader::RustIndex);
        assert!(snap.reindexed);
        assert!(snap.calls.len() >= 6, "fixture has calls: {}", snap.calls.len());
        assert!(snap.calls.iter().all(|c| !c.file.is_empty()), "every call knows its source file");
        assert!(snap.calls.iter().any(|c| c.skill == "review"));
        let claude = snap.providers.iter().find(|p| p.slug == "claude-code").unwrap();
        assert!(claude.available);
        assert!(claude.path.starts_with(&home));
        assert!(!claude.overridden);
        assert_eq!(snap.providers.len(), 5);

        // Second read within 60 s reuses the index.
        let again = read_via_index(&settings, &home, false).unwrap();
        assert!(!again.reindexed);
        assert_eq!(again.calls.len(), snap.calls.len());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn path_override_redirects_a_provider() {
        let home = fixture_home();
        let dir = std::env::temp_dir().join(format!("skilled-desktop-override-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let settings = Settings {
            db_path: dir.join("index.db").display().to_string(),
            paths: PathOverrides { codex: Some("/definitely/missing".into()), ..Default::default() },
            ..Default::default()
        };
        let snap = read_via_index(&settings, &home, false).unwrap();
        let codex = snap.providers.iter().find(|p| p.slug == "codex").unwrap();
        assert!(codex.overridden);
        assert!(!codex.available);
        assert_eq!(codex.path, "/definitely/missing");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn cli_mode_without_cli_reports_a_clear_error() {
        let settings = Settings { reader_mode: ReaderMode::Cli, ..Default::default() };
        // Ensure no `skilled` resolves: empty PATH and a fake HOME.
        let old_path = std::env::var("PATH").ok();
        let old_home = std::env::var("HOME").ok();
        std::env::set_var("PATH", "");
        std::env::set_var("HOME", "/nonexistent-skilled-home");
        let err = load(&settings, "/nonexistent-skilled-home", false).unwrap_err();
        if let Some(p) = old_path { std::env::set_var("PATH", p); }
        if let Some(h) = old_home { std::env::set_var("HOME", h); }
        assert!(err.contains("skilled` CLI is not installed"), "{err}");
    }
}
