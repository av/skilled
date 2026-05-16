use std::collections::HashSet;
use std::fs;
use std::path::Path;

use regex::Regex;
use serde_json::Value;

use crate::model::{ProviderResult, SkillCall};

const SOURCE: &str = "Grok CLI";

const BUILTINS: &[&str] = &[
    "compact",
    "always-approve",
    "context",
    "plugins",
    "reload-plugins",
    "session-info",
    "imagine",
    "imagine-video",
    "feedback",
    "loop",
    "help",
    "memory",
    "clear",
    "exit",
];

pub fn collect(home: &str) -> ProviderResult {
    let sessions_dir = format!("{home}/.grok/sessions");
    let available = Path::new(&sessions_dir).is_dir();

    if !available {
        return ProviderResult {
            name: SOURCE.into(),
            available: false,
            calls: vec![],
        };
    }

    let builtins: HashSet<&str> = BUILTINS.iter().copied().collect();
    let cmd_re = Regex::new(r"<command-name>([^<]+)</command-name>").unwrap();
    let mut calls = Vec::new();

    let project_dirs = match fs::read_dir(&sessions_dir) {
        Ok(d) => d,
        Err(_) => {
            return ProviderResult {
                name: SOURCE.into(),
                available: true,
                calls: vec![],
            };
        }
    };

    for proj_entry in project_dirs.flatten() {
        let dir_name = proj_entry.file_name().to_string_lossy().to_string();
        if !dir_name.starts_with("%2F") {
            continue;
        }

        let project = urlencoding::decode(&dir_name)
            .unwrap_or_default()
            .to_string();
        let proj_path = proj_entry.path();

        let session_dirs = match fs::read_dir(&proj_path) {
            Ok(d) => d,
            Err(_) => continue,
        };

        for session_entry in session_dirs.flatten() {
            if !session_entry.path().is_dir() {
                continue;
            }

            let session_dir_name = session_entry.file_name().to_string_lossy().to_string();
            let updates_path = session_entry.path().join("updates.jsonl");

            if !updates_path.exists() {
                continue;
            }

            let content = match fs::read_to_string(&updates_path) {
                Ok(c) => c,
                Err(_) => continue,
            };

            for line in content.lines() {
                if line.trim().is_empty() {
                    continue;
                }

                let record: Value = match serde_json::from_str(line) {
                    Ok(v) => v,
                    Err(_) => continue,
                };

                let update = &record["params"]["update"];
                if update["sessionUpdate"].as_str() != Some("user_message_chunk") {
                    continue;
                }

                let msg_content = &update["content"];
                if msg_content["type"].as_str() != Some("text") {
                    continue;
                }

                let text = msg_content["text"].as_str().unwrap_or("");
                let caps = match cmd_re.captures(text) {
                    Some(c) => c,
                    None => continue,
                };
                let skill = &caps[1];
                if builtins.contains(skill) {
                    continue;
                }

                // Grok timestamps are in seconds, convert to milliseconds
                let ts = record["timestamp"]
                    .as_f64()
                    .map(|f| (f * 1000.0) as i64)
                    .or_else(|| record["timestamp"].as_i64().map(|n| n * 1000))
                    .unwrap_or(0);

                calls.push(SkillCall {
                    skill: skill.to_string(),
                    timestamp_ms: ts,
                    project: project.clone(),
                    session_id: record["params"]["sessionId"]
                        .as_str()
                        .unwrap_or(&session_dir_name)
                        .to_string(),
                    source: SOURCE.into(),
                });
            }
        }
    }

    ProviderResult {
        name: SOURCE.into(),
        available,
        calls,
    }
}
