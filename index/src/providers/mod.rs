pub mod claude_code;
pub mod codex;
pub mod droid;
pub mod grok;
pub mod opencode;

use crate::model::ProviderResult;

/// Location each provider reads from. `None` means "auto-detect from `$HOME`
/// and the provider's environment variables", exactly like the CLI.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProviderPaths {
    pub claude_code: Option<String>,
    pub codex: Option<String>,
    pub droid: Option<String>,
    pub opencode: Option<String>,
    pub grok: Option<String>,
}

/// A provider's display name and the path it will read for the given overrides.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderLocation {
    pub name: &'static str,
    pub slug: &'static str,
    pub path: String,
    pub overridden: bool,
}

/// Provider order is stable and shared by the CLI, TUI and desktop.
pub fn locations(home: &str, paths: &ProviderPaths) -> Vec<ProviderLocation> {
    let pick = |name: &'static str, slug: &'static str, o: &Option<String>, d: String| ProviderLocation {
        name,
        slug,
        path: o.clone().unwrap_or(d),
        overridden: o.is_some(),
    };
    vec![
        pick("Claude Code", "claude-code", &paths.claude_code, claude_code::default_root(home)),
        pick("Codex CLI", "codex", &paths.codex, codex::default_root(home)),
        pick("Droid CLI", "droid", &paths.droid, droid::default_root(home)),
        pick("OpenCode", "opencode", &paths.opencode, opencode::default_root(home)),
        pick("Grok CLI", "grok", &paths.grok, grok::default_root(home)),
    ]
}

/// Collect every provider using auto-detected paths (CLI behaviour).
pub fn all_providers(home: &str, progress: bool) -> Vec<ProviderResult> {
    all_providers_with(home, &ProviderPaths::default(), progress)
}

/// Collect every provider, honouring per-provider path overrides.
pub fn all_providers_with(home: &str, paths: &ProviderPaths, progress: bool) -> Vec<ProviderResult> {
    let locs = locations(home, paths);
    let collectors: [fn(&str) -> ProviderResult; 5] = [
        claude_code::collect_at,
        codex::collect_at,
        droid::collect_at,
        opencode::collect_at,
        grok::collect_at,
    ];

    let mut results = Vec::new();
    for (loc, collect) in locs.iter().zip(collectors) {
        let result = collect(&loc.path);
        if progress {
            if result.available {
                eprintln!("  {} — {} calls", result.name, result.calls.len());
            } else {
                eprintln!("  {} — skipped", result.name);
            }
        }
        results.push(result);
    }
    results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overrides_replace_defaults_only_where_set() {
        let paths = ProviderPaths { codex: Some("/tmp/codex-sessions".into()), ..Default::default() };
        let locs = locations("/home/u", &paths);
        assert_eq!(locs.len(), 5);
        assert_eq!(locs[1].slug, "codex");
        assert_eq!(locs[1].path, "/tmp/codex-sessions");
        assert!(locs[1].overridden);
        assert_eq!(locs[2].path, "/home/u/.factory/sessions");
        assert!(!locs[2].overridden);
    }

    #[test]
    fn missing_override_path_is_reported_unavailable() {
        let paths = ProviderPaths { droid: Some("/nonexistent/skilled-test".into()), ..Default::default() };
        let results = all_providers_with("/nonexistent/home", &paths, false);
        let droid = results.iter().find(|r| r.name == "Droid CLI").unwrap();
        assert!(!droid.available);
        assert!(droid.calls.is_empty());
    }
}
