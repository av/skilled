use std::collections::HashSet;
use std::path::Path;

use regex::Regex;
use serde_json::Value;
use walkdir::WalkDir;

use crate::model::{ProviderResult, SkillCall};

const SOURCE: &str = "Codex CLI";

const BUILTINS: &[&str] = &[
    "exit", "help", "model", "clear", "compact", "undo", "diff", "history", "settings", "version",
    "approve", "status", "imagegen", "openai-docs", "plugin-creator", "skill-creator",
    "skill-installer",
];

pub fn collect(home: &str) -> ProviderResult {
    let sessions_dir = format!("{home}/.codex/sessions");
    let available = Path::new(&sessions_dir).is_dir();

    if !available {
        return ProviderResult {
            name: SOURCE.into(),
            available: false,
            calls: vec![],
        };
    }

    let builtins: HashSet<&str> = BUILTINS.iter().copied().collect();
    let name_re = Regex::new(r"<name>([^<]+)</name>").unwrap();
    let mut calls = Vec::new();

    for entry in WalkDir::new(&sessions_dir)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        parse_session(path, &builtins, &name_re, &mut calls);
    }

    ProviderResult {
        name: SOURCE.into(),
        available,
        calls,
    }
}

fn parse_session(
    path: &Path,
    builtins: &HashSet<&str>,
    name_re: &Regex,
    calls: &mut Vec<SkillCall>,
) {
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return,
    };

    let mut project = String::new();
    let mut session_id = String::new();

    for line in content.lines() {
        if line.trim().is_empty() {
            continue;
        }

        let entry: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        match entry["type"].as_str() {
            Some("session_meta") => {
                project = entry["payload"]["cwd"].as_str().unwrap_or("").to_string();
                session_id = entry["payload"]["id"].as_str().unwrap_or("").to_string();
            }
            Some("response_item") => {
                let content_arr = match entry["payload"]["content"].as_array() {
                    Some(a) => a,
                    None => continue,
                };

                for part in content_arr {
                    if part["type"].as_str() != Some("input_text") {
                        continue;
                    }
                    let text = part["text"].as_str().unwrap_or("");
                    if !text.contains("<skill>") {
                        continue;
                    }

                    for caps in name_re.captures_iter(text) {
                        let skill = &caps[1];
                        if builtins.contains(skill) {
                            continue;
                        }

                        let ts = parse_timestamp(&entry["timestamp"]);

                        calls.push(SkillCall {
                            skill: skill.to_string(),
                            timestamp_ms: ts,
                            project: project.clone(),
                            session_id: session_id.clone(),
                            source: SOURCE.into(),
                        });
                    }
                }
            }
            _ => {}
        }
    }
}

fn parse_timestamp(v: &Value) -> i64 {
    if let Some(n) = v.as_i64() {
        return n;
    }
    if let Some(s) = v.as_str() {
        if let Ok(n) = s.parse::<i64>() {
            return n;
        }
        return super::claude_code::parse_iso_ms(s).unwrap_or(0);
    }
    if let Some(f) = v.as_f64() {
        return f as i64;
    }
    0
}
