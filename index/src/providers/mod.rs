mod claude_code;
mod codex;
mod droid;
mod grok;
mod opencode;

use crate::model::ProviderResult;

pub fn all_providers(home: &str, progress: bool) -> Vec<ProviderResult> {
    let collectors: [fn(&str) -> ProviderResult; 5] = [
        claude_code::collect,
        codex::collect,
        droid::collect,
        opencode::collect,
        grok::collect,
    ];

    let mut results = Vec::new();
    for collect in collectors {
        let result = collect(home);
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
