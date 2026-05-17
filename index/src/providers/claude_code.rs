use std::collections::HashSet;
use std::fs;
use std::path::Path;

use regex::Regex;
use serde_json::Value;
use walkdir::WalkDir;

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
    let skill_re = Regex::new(r"^/([a-zA-Z][a-zA-Z0-9_-]*)(?:\s|$)").unwrap();
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

        // Recursively walk the project directory to find all .jsonl files,
        // including those in subagent directories (e.g., <session>/subagents/*.jsonl).
        for file in WalkDir::new(&proj_dir)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let path = file.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            if !path.is_file() {
                continue;
            }
            parse_session_file(path, builtins, seen, calls);
        }
    }
}

fn parse_session_file(
    path: &Path,
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

    // Extract project path (cwd) from session entries rather than
    // decoding the directory name, which is ambiguous when paths contain hyphens.
    let mut project = String::new();

    for line in content.lines() {
        if line.trim().is_empty() {
            continue;
        }

        // Fast path: extract cwd from any early entry that has it
        if project.is_empty() && line.contains("\"cwd\"") {
            if let Ok(entry) = serde_json::from_str::<Value>(line) {
                if let Some(cwd) = entry["cwd"].as_str() {
                    project = cwd.to_string();
                }
            }
        }

        if !line.contains("\"Skill\"") {
            continue;
        }

        let entry: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        if project.is_empty() {
            if let Some(cwd) = entry["cwd"].as_str() {
                project = cwd.to_string();
            }
        }

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

            let call_project = if project.is_empty() {
                entry["cwd"].as_str().unwrap_or("").to_string()
            } else {
                project.clone()
            };

            calls.push(SkillCall {
                skill: skill.to_string(),
                timestamp_ms: ts,
                project: call_project,
                session_id: session_id.clone(),
                source: SOURCE.into(),
            });
        }
    }
}

pub fn parse_iso_ms(s: &str) -> Option<i64> {
    // Minimal ISO 8601 parser supporting:
    //   "2026-05-15T20:43:17.000Z"
    //   "2026-05-15T20:43:17.000+02:00"
    //   "2026-05-15T20:43:17.000-05:30"

    let (date, time_with_tz) = s.split_once('T')?;
    let parts: Vec<&str> = date.split('-').collect();
    if parts.len() != 3 {
        return None;
    }
    let year: i64 = parts[0].parse().ok()?;
    let month: i64 = parts[1].parse().ok()?;
    let day: i64 = parts[2].parse().ok()?;

    // Separate the time portion from the timezone offset.
    // Possible formats: "20:43:17.000Z", "20:43:17.000+02:00", "20:43:17.000-05:30", "20:43:17"
    let (time_str, tz_offset_ms) = strip_tz_offset(time_with_tz);

    let time_parts: Vec<&str> = time_str.split(':').collect();
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
    Some(total_secs * 1000 + millis - tz_offset_ms)
}

/// Strip timezone suffix from a time string and return (time_without_tz, offset_in_ms).
/// Handles "Z", "+HH:MM", "-HH:MM", "+HHMM", "-HHMM", or no suffix (assumed UTC).
fn strip_tz_offset(time: &str) -> (&str, i64) {
    // Trailing Z
    if let Some(t) = time.strip_suffix('Z') {
        return (t, 0);
    }

    // Look for +/- offset. The offset is always at least 5 chars from the end (+HH:MM or +HHMM).
    // We search for the last '+' or '-' that isn't at position 0 and is after the seconds portion.
    let offset_pos = time.rfind('+').or_else(|| {
        // rfind('-') but only if it's after the time digits (position > 5 typically HH:MM:SS)
        let pos = time.rfind('-')?;
        // Ensure this isn't part of fractional seconds by checking it's after seconds
        if pos >= 8 { Some(pos) } else { None }
    });

    if let Some(pos) = offset_pos {
        // Validate that what comes after is a timezone offset, not part of time
        // Offset chars should be: sign + 2-digit hour + optional colon + 2-digit minute
        let sign_char = time.as_bytes()[pos];
        let offset_str = &time[pos + 1..];
        let (oh, om) = if offset_str.contains(':') {
            let offset_parts: Vec<&str> = offset_str.split(':').collect();
            if offset_parts.len() != 2 { return (time, 0); }
            let oh: i64 = match offset_parts[0].parse() { Ok(v) => v, Err(_) => return (time, 0) };
            let om: i64 = match offset_parts[1].parse() { Ok(v) => v, Err(_) => return (time, 0) };
            (oh, om)
        } else if offset_str.len() == 4 {
            let oh: i64 = match offset_str[..2].parse() { Ok(v) => v, Err(_) => return (time, 0) };
            let om: i64 = match offset_str[2..].parse() { Ok(v) => v, Err(_) => return (time, 0) };
            (oh, om)
        } else {
            return (time, 0);
        };

        let sign: i64 = if sign_char == b'+' { 1 } else { -1 };
        let offset_ms = sign * (oh * 3600 + om * 60) * 1000;
        return (&time[..pos], offset_ms);
    }

    // No timezone info — assume UTC
    (time, 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_iso_ms_z_suffix() {
        let result = parse_iso_ms("2026-05-15T20:43:17.000Z");
        assert!(result.is_some());
        assert_eq!(result.unwrap(), 1_778_877_797_000);
    }

    #[test]
    fn test_parse_iso_ms_positive_offset() {
        let z = parse_iso_ms("2026-05-15T20:43:17.000Z").unwrap();
        let plus2 = parse_iso_ms("2026-05-15T20:43:17.000+02:00").unwrap();
        // +02:00 wall clock is 2h ahead of UTC, so UTC time is 2h earlier
        assert_eq!(z - plus2, 2 * 3600 * 1000);
    }

    #[test]
    fn test_parse_iso_ms_negative_offset() {
        let z = parse_iso_ms("2026-05-15T20:43:17.000Z").unwrap();
        let neg530 = parse_iso_ms("2026-05-15T20:43:17.000-05:30").unwrap();
        // -05:30 wall clock is 5h30m behind UTC, so UTC time is 5h30m later
        assert_eq!(neg530 - z, (5 * 3600 + 30 * 60) * 1000);
    }

    #[test]
    fn test_parse_iso_ms_no_suffix() {
        let z = parse_iso_ms("2026-05-15T20:43:17.000Z").unwrap();
        let none = parse_iso_ms("2026-05-15T20:43:17.000").unwrap();
        assert_eq!(z, none);
    }

    #[test]
    fn test_parse_iso_ms_no_fractional() {
        let result = parse_iso_ms("2026-05-15T20:43:17Z");
        assert!(result.is_some());
        assert_eq!(result.unwrap(), 1_778_877_797_000);
    }

    #[test]
    fn test_parse_iso_ms_compact_offset() {
        let colon = parse_iso_ms("2026-05-15T20:43:17.000+02:00").unwrap();
        let compact = parse_iso_ms("2026-05-15T20:43:17.000+0200").unwrap();
        assert_eq!(colon, compact);
    }
}
