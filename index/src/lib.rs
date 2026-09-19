//! `skilled-index`: reads local AI-coding-tool histories and writes the skill
//! usage index at `~/.skilled/index.db`. Used as a binary by the CLI/TUI and
//! linked in-process by the desktop app so both share one parser.

pub mod db;
pub mod model;
pub mod providers;

pub use db::{read_index, write_index, IndexSnapshot, IndexStats, ProviderRow};
pub use model::{ProviderResult, SkillCall};
pub use providers::{all_providers, all_providers_with, locations, ProviderLocation, ProviderPaths};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Default index path, identical to the TUI's `~/.skilled/index.db`.
pub fn default_db_path(home: &str) -> std::path::PathBuf {
    std::path::PathBuf::from(home).join(".skilled").join("index.db")
}

/// Home directory the same way the binary resolves it.
pub fn home_dir() -> String {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| "/tmp".into())
}
