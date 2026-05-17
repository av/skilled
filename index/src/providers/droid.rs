use std::path::Path;

use regex::Regex;
use serde_json::Value;
use walkdir::WalkDir;

use crate::model::{ProviderResult, SkillCall};

const SOURCE: &str = "Droid CLI";

pub fn collect(home: &str) -> ProviderResult {
    let sessions_dir = format!("{home}/.factory/sessions");
    let available = Path::new(&sessions_dir).is_dir();

    if !available {
        return ProviderResult {
            name: SOURCE.into(),
            available: false,
            calls: vec![],
        };
    }

    let active_re = Regex::new(r#"Skill "([^"]+)" is now active"#).unwrap();
    let mut calls = Vec::new();

    for entry in WalkDir::new(&sessions_dir)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }

        parse_session(path, &active_re, &mut calls);
    }

    ProviderResult {
        name: SOURCE.into(),
        available,
        calls,
    }
}

fn parse_session(path: &Path, active_re: &Regex, calls: &mut Vec<SkillCall>) {
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return,
    };

    let mut session_id = String::new();
    let mut project = String::new();

    for line in content.lines() {
        if line.trim().is_empty() {
            continue;
        }

        let entry: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        if entry["type"].as_str() == Some("session_start") {
            session_id = entry["id"].as_str().unwrap_or("").to_string();
            // Extract project path from session metadata
            if let Some(cwd) = entry["cwd"].as_str() {
                project = cwd.to_string();
            }
            continue;
        }

        if entry["type"].as_str() != Some("message") {
            continue;
        }

        let content_arr = match entry["message"]["content"].as_array() {
            Some(a) => a,
            None => continue,
        };

        for part in content_arr {
            if part["type"].as_str() != Some("tool_result") {
                continue;
            }

            let text = part["content"].as_str().unwrap_or("");
            let caps = match active_re.captures(text) {
                Some(c) => c,
                None => continue,
            };
            let skill = &caps[1];

            let ts = entry["timestamp"]
                .as_str()
                .and_then(super::claude_code::parse_iso_ms)
                .or_else(|| entry["timestamp"].as_i64())
                .unwrap_or(0);

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
