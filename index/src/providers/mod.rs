mod claude_code;
mod codex;
mod droid;
mod grok;
mod opencode;

use crate::model::ProviderResult;

pub fn all_providers(home: &str) -> Vec<ProviderResult> {
    vec![
        claude_code::collect(home),
        codex::collect(home),
        droid::collect(home),
        opencode::collect(home),
        grok::collect(home),
    ]
}
