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

/// Extract millisecond timestamp from a UUIDv7 string (first 48 bits).
fn uuidv7_to_ms(uuid: &str) -> i64 {
    let hex: String = uuid.chars().filter(|c| *c != '-').take(12).collect();
    i64::from_str_radix(&hex, 16).unwrap_or(0)
}

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
            let mut seen = HashSet::new();

            // Source 1: updates.jsonl — has per-message timestamps
            let updates_path = session_entry.path().join("updates.jsonl");
            if updates_path.exists() {
                if let Ok(content) = fs::read_to_string(&updates_path) {
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
                        for caps in cmd_re.captures_iter(text) {
                            let skill = &caps[1];
                            if builtins.contains(skill) {
                                continue;
                            }

                            seen.insert(skill.to_string());

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
            }

            // Source 2: chat_history.jsonl — captures all user skill invocations
            // that may not appear in updates.jsonl (e.g., subagent-spawned sessions,
            // sessions where the update stream was incomplete).
            let chat_path = session_entry.path().join("chat_history.jsonl");
            if chat_path.exists() {
                if let Ok(content) = fs::read_to_string(&chat_path) {
                    // Use UUIDv7 session timestamp as fallback
                    let session_ts = uuidv7_to_ms(&session_dir_name);

                    for line in content.lines() {
                        if line.trim().is_empty() || !line.contains("command-name") {
                            continue;
                        }

                        let record: Value = match serde_json::from_str(line) {
                            Ok(v) => v,
                            Err(_) => continue,
                        };

                        if record["type"].as_str() != Some("user") {
                            continue;
                        }

                        let text = match &record["content"] {
                            Value::String(s) => s.clone(),
                            Value::Array(arr) => arr
                                .iter()
                                .filter_map(|p| p["text"].as_str())
                                .collect::<Vec<_>>()
                                .join(""),
                            _ => continue,
                        };

                        for caps in cmd_re.captures_iter(&text) {
                            let skill = &caps[1];
                            if builtins.contains(skill) || seen.contains(skill) {
                                continue;
                            }
                            seen.insert(skill.to_string());

                            calls.push(SkillCall {
                                skill: skill.to_string(),
                                timestamp_ms: session_ts,
                                project: project.clone(),
                                session_id: session_dir_name.clone(),
                                source: SOURCE.into(),
                            });
                        }
                    }
                }
            }
        }
    }

    ProviderResult {
        name: SOURCE.into(),
        available,
        calls,
    }
}
