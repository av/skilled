use std::collections::HashSet;
use std::fs;
use std::path::Path;

use regex::Regex;
use serde_json::Value;

use crate::model::{ProviderResult, SkillCall};

const SOURCE: &str = "Claude Code";

const BUILTINS: &[&str] = &[
    "clear", "model", "usage", "resume", "new", "quit", "exit", "login", "logout", "help",
    "config", "compact", "doctor", "cost", "effort", "memory", "status", "skills", "permissions",
    "mcp", "terminal-setup", "remote-env", "remote-control", "fast",
];

pub fn collect(home: &str) -> ProviderResult {
    let claude_home = format!("{home}/.claude");
    let history_path = format!("{claude_home}/history.jsonl");
    let projects_dir = format!("{claude_home}/projects");

    let available = Path::new(&history_path).exists();
    if !available {
        return ProviderResult {
            name: SOURCE.into(),
            available: false,
            calls: vec![],
        };
    }

    let builtins: HashSet<&str> = BUILTINS.iter().copied().collect();
    let skill_re = Regex::new(r"^/([a-zA-Z][a-zA-Z0-9_-]*)$").unwrap();
    let mut seen = HashSet::new();
    let mut calls = Vec::new();

    if let Ok(content) = fs::read_to_string(&history_path) {
        for line in content.lines() {
            if line.trim().is_empty() {
                continue;
            }
            let entry: Value = match serde_json::from_str(line) {
                Ok(v) => v,
                Err(_) => continue,
            };

            let display = entry["display"].as_str().unwrap_or("");
            let caps = match skill_re.captures(display) {
                Some(c) => c,
                None => continue,
            };
            let skill = &caps[1];
            if builtins.contains(skill) {
                continue;
            }

            let ts = entry["timestamp"].as_i64().unwrap_or(0);
            let key = format!("{skill}:{ts}");
            if !seen.insert(key) {
                continue;
            }

            calls.push(SkillCall {
                skill: skill.to_string(),
                timestamp_ms: ts,
                project: entry["project"].as_str().unwrap_or("").to_string(),
                session_id: entry["sessionId"].as_str().unwrap_or("").to_string(),
                source: SOURCE.into(),
            });
        }
    }

    if Path::new(&projects_dir).is_dir() {
        collect_projects(&projects_dir, &builtins, &mut seen, &mut calls);
    }

    ProviderResult {
        name: SOURCE.into(),
        available,
        calls,
    }
}

fn collect_projects(
    projects_dir: &str,
    builtins: &HashSet<&str>,
    seen: &mut HashSet<String>,
    calls: &mut Vec<SkillCall>,
) {
    let entries = match fs::read_dir(projects_dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let proj_dir = entry.path();
        if !proj_dir.is_dir() {
            continue;
        }

        let dir_name = entry.file_name().to_string_lossy().to_string();
        let project = format!(
            "/{}",
            dir_name.strip_prefix('-').unwrap_or(&dir_name).replace('-', "/")
        );

        let files = match fs::read_dir(&proj_dir) {
            Ok(f) => f,
            Err(_) => continue,
        };

        for file in files.flatten() {
            let path = file.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            parse_session_file(&path, &project, builtins, seen, calls);
        }
    }
}

fn parse_session_file(
    path: &Path,
    project: &str,
    builtins: &HashSet<&str>,
    seen: &mut HashSet<String>,
    calls: &mut Vec<SkillCall>,
) {
    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return,
    };

    let session_id = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();

    for line in content.lines() {
        if !line.contains("\"Skill\"") {
            continue;
        }

        let entry: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        if entry["type"].as_str() != Some("assistant") {
            continue;
        }

        let content_arr = match entry["message"]["content"].as_array() {
            Some(a) => a,
            None => continue,
        };

        for part in content_arr {
            if part["type"].as_str() != Some("tool_use") || part["name"].as_str() != Some("Skill")
            {
                continue;
            }

            let skill = match part["input"]["skill"].as_str() {
                Some(s) if !s.is_empty() && !builtins.contains(s) => s,
                _ => continue,
            };

            let ts = entry["timestamp"]
                .as_str()
                .and_then(|s| {
                    s.parse::<i64>().ok().or_else(|| {
                        // ISO date string — parse manually
                        parse_iso_ms(s)
                    })
                })
                .or_else(|| entry["timestamp"].as_i64())
                .unwrap_or(0);

            let key = format!("{skill}:{ts}");
            if !seen.insert(key) {
                continue;
            }

            calls.push(SkillCall {
                skill: skill.to_string(),
                timestamp_ms: ts,
                project: project.to_string(),
                session_id: session_id.clone(),
                source: SOURCE.into(),
            });
        }
    }
}

pub fn parse_iso_ms(s: &str) -> Option<i64> {
    // Minimal ISO 8601 parser: "2026-05-15T20:43:17.000Z" -> unix ms
    let s = s.trim_end_matches('Z');
    let (date, time) = s.split_once('T')?;
    let parts: Vec<&str> = date.split('-').collect();
    if parts.len() != 3 {
        return None;
    }
    let year: i64 = parts[0].parse().ok()?;
    let month: i64 = parts[1].parse().ok()?;
    let day: i64 = parts[2].parse().ok()?;

    let time_parts: Vec<&str> = time.split(':').collect();
    if time_parts.len() != 3 {
        return None;
    }
    let hour: i64 = time_parts[0].parse().ok()?;
    let min: i64 = time_parts[1].parse().ok()?;
    let sec_str = time_parts[2];
    let (sec_int, millis) = if let Some((s, frac)) = sec_str.split_once('.') {
        let s: i64 = s.parse().ok()?;
        let padded = match frac.len() {
            1 => format!("{frac}00"),
            2 => format!("{frac}0"),
            _ => frac[..3].to_string(),
        };
        let ms: i64 = padded.parse().ok()?;
        (s, ms)
    } else {
        (sec_str.parse::<i64>().ok()?, 0)
    };

    // Days from epoch using a simplified calculation
    let y = if month <= 2 { year - 1 } else { year };
    let m = if month <= 2 { month + 9 } else { month - 3 };
    let days = 365 * y + y / 4 - y / 100 + y / 400 + (m * 306 + 5) / 10 + day - 1 - 719468;
    let total_secs = days * 86400 + hour * 3600 + min * 60 + sec_int;
    Some(total_secs * 1000 + millis)
}
