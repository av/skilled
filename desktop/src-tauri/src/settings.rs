//! User settings, persisted as JSON in the Tauri app config dir.

use serde::{Deserialize, Serialize};
use skilled_index::ProviderPaths;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ReaderMode {
    /// Rust indexer in-process (default); falls back to the CLI when it fails.
    Index,
    /// Always use the installed `skilled` CLI with `--no-index` (TypeScript providers).
    Cli,
}

impl Default for ReaderMode {
    fn default() -> Self {
        ReaderMode::Index
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Theme {
    System,
    Light,
    Dark,
}

impl Default for Theme {
    fn default() -> Self {
        Theme::System
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct PathOverrides {
    pub claude_code: Option<String>,
    pub codex: Option<String>,
    pub droid: Option<String>,
    pub opencode: Option<String>,
    pub grok: Option<String>,
}

impl PathOverrides {
    fn clean(v: &Option<String>) -> Option<String> {
        v.as_ref().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
    }
    pub fn to_provider_paths(&self) -> ProviderPaths {
        ProviderPaths {
            claude_code: Self::clean(&self.claude_code),
            codex: Self::clean(&self.codex),
            droid: Self::clean(&self.droid),
            opencode: Self::clean(&self.opencode),
            grok: Self::clean(&self.grok),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub reader_mode: ReaderMode,
    /// Custom index DB path; empty = `~/.skilled/index.db` (shared with the TUI).
    pub db_path: String,
    /// Seconds between automatic refreshes; 0 disables the interval (file watch still runs).
    pub refresh_interval_secs: u32,
    /// Watch provider directories and refresh on change.
    pub watch_files: bool,
    /// Case-insensitive substrings; matching skills are hidden everywhere.
    pub noise_skills: Vec<String>,
    /// Case-insensitive substrings; calls whose project path matches are hidden.
    pub noise_projects: Vec<String>,
    /// Sources (provider names) to hide entirely.
    pub noise_sources: Vec<String>,
    pub theme: Theme,
    /// Closing the window hides to tray instead of quitting.
    pub close_to_tray: bool,
    pub show_tray: bool,
    pub paths: PathOverrides,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            reader_mode: ReaderMode::Index,
            db_path: String::new(),
            refresh_interval_secs: 300,
            watch_files: true,
            noise_skills: vec![],
            noise_projects: vec![],
            noise_sources: vec![],
            theme: Theme::System,
            close_to_tray: true,
            show_tray: true,
            paths: PathOverrides::default(),
        }
    }
}

impl Settings {
    pub fn file(config_dir: &Path) -> PathBuf {
        config_dir.join("settings.json")
    }

    pub fn load(config_dir: &Path) -> Settings {
        fs::read_to_string(Self::file(config_dir))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, config_dir: &Path) -> Result<(), String> {
        fs::create_dir_all(config_dir).map_err(|e| format!("create config dir: {e}"))?;
        let tmp = Self::file(config_dir).with_extension("json.tmp");
        let json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(&tmp, json).map_err(|e| format!("write settings: {e}"))?;
        fs::rename(&tmp, Self::file(config_dir)).map_err(|e| format!("commit settings: {e}"))
    }

    pub fn db_path(&self, home: &str) -> PathBuf {
        let trimmed = self.db_path.trim();
        if trimmed.is_empty() {
            skilled_index::default_db_path(home)
        } else {
            PathBuf::from(trimmed)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_defaults() {
        let dir = std::env::temp_dir().join(format!("skilled-settings-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        assert_eq!(Settings::load(&dir), Settings::default());
        let mut s = Settings::default();
        s.noise_skills.push("test".into());
        s.paths.codex = Some("  /tmp/codex ".into());
        s.save(&dir).unwrap();
        let loaded = Settings::load(&dir);
        assert_eq!(loaded, s);
        assert_eq!(loaded.paths.to_provider_paths().codex.as_deref(), Some("/tmp/codex"));
        assert!(loaded.paths.to_provider_paths().grok.is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn unknown_fields_and_partial_json_still_load() {
        let s: Settings = serde_json::from_str(r#"{"refreshIntervalSecs": 30, "future": 1}"#).unwrap();
        assert_eq!(s.refresh_interval_secs, 30);
        assert_eq!(s.reader_mode, ReaderMode::Index);
    }

    #[test]
    fn db_path_defaults_to_tui_location() {
        let s = Settings::default();
        assert_eq!(s.db_path("/home/u"), PathBuf::from("/home/u/.skilled/index.db"));
        let custom = Settings { db_path: "/tmp/x.db".into(), ..Default::default() };
        assert_eq!(custom.db_path("/home/u"), PathBuf::from("/tmp/x.db"));
    }
}
