use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

use regex::Regex;
use serde_json::Value;
use std::sync::OnceLock;

use super::grok::skill_name_from_skill_md_path;
use crate::model::{ProviderResult, SkillCall};

const SOURCE: &str = "Cursor";

fn timestamp_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"(?i)<timestamp>[A-Za-z]+,\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4}),\s+(\d{1,2}):(\d{2})\s*(AM|PM)\s*\(UTC([+-]\d{1,2})(?::(\d{2}))?\)\s*</timestamp>",
        )
        .unwrap()
    })
}

fn month_index(name: &str) -> Option<i64> {
    const MONTHS: [&str; 12] = [
        "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
    ];
    MONTHS
        .iter()
        .position(|m| m.eq_ignore_ascii_case(name))
        .map(|i| i as i64)
}

/// Days since 1970-01-01. Howard Hinnant `days_from_civil`. `m` is 1–12.
fn days_from_civil(mut y: i64, m: i64, d: i64) -> i64 {
    y -= i64::from(m <= 2);
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as u64;
    let mp = if m > 2 { m - 3 } else { m + 9 };
    let doy = ((153 * mp + 2) / 5 + d - 1) as u64;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe as i64 - 719468
}

/// `<timestamp>Tuesday, Oct 27, 2026, 10:39 PM (UTC+8)</timestamp>`
fn parse_cursor_timestamp_ms(text: &str) -> Option<i64> {
    let c = timestamp_re().captures(text)?;
    let month = month_index(c.get(1)?.as_str())?;
    let day: i64 = c.get(2)?.as_str().parse().ok()?;
    let year: i64 = c.get(3)?.as_str().parse().ok()?;
    let mut hour: i64 = c.get(4)?.as_str().parse().ok()?;
    let minute: i64 = c.get(5)?.as_str().parse().ok()?;
    let ampm = c.get(6)?.as_str();
    let off_h: i64 = c.get(7)?.as_str().parse().ok()?;
    let off_m: i64 = c
        .get(8)
        .map(|m| m.as_str().parse().unwrap_or(0))
        .unwrap_or(0);
    if ampm.eq_ignore_ascii_case("AM") {
        if hour == 12 {
            hour = 0;
        }
    } else if hour != 12 {
        hour += 12;
    }
    let days = days_from_civil(year, month + 1, day);
    let local_ms = (days * 86_400 + hour * 3_600 + minute * 60) * 1000;
    let sign = off_h.signum();
    let offset_ms = (off_h * 3_600 + sign * off_m * 60) * 1000;
    Some(local_ms - offset_ms)
}

fn message_text(content: &Value) -> String {
    match content {
        Value::String(s) => s.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
            .collect::<Vec<_>>()
            .join(""),
        _ => String::new(),
    }
}

fn file_mtime_ms(path: &Path) -> i64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn default_root(home: &str) -> String {
    format!("{home}/.cursor/projects")
}

pub fn collect(home: &str) -> ProviderResult {
    collect_at(&default_root(home))
}

pub fn collect_at(projects_dir: &str) -> ProviderResult {
    let available = Path::new(projects_dir).is_dir();
    if !available {
        return ProviderResult {
            name: SOURCE.into(),
            available: false,
            calls: vec![],
        };
    }
    ProviderResult {
        name: SOURCE.into(),
        available: true,
        calls: collect_from_dir(projects_dir),
    }
}

fn collect_from_dir(projects_dir: &str) -> Vec<SkillCall> {
    let mut calls = Vec::new();
    let project_dirs = match fs::read_dir(projects_dir) {
        Ok(d) => d,
        Err(_) => return calls,
    };

    for proj_entry in project_dirs.flatten() {
        if !proj_entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let project = proj_entry.file_name().to_string_lossy().to_string();
        let transcripts = proj_entry.path().join("agent-transcripts");
        let session_dirs = match fs::read_dir(&transcripts) {
            Ok(d) => d,
            Err(_) => continue,
        };

        for session_entry in session_dirs.flatten() {
            if !session_entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let session_id = session_entry.file_name().to_string_lossy().to_string();
            let file = session_entry.path().join(format!("{session_id}.jsonl"));
            let content = match fs::read_to_string(&file) {
                Ok(s) => s,
                Err(_) => continue,
            };
            // Using file mtime instead of <timestamp> when the user line has no <timestamp> tag.
            // Per-read times need a Cursor field that does not exist yet.
            let mut ts = file_mtime_ms(&file);
            let mut seen = HashSet::new();

            for line in content.lines() {
                if line.trim().is_empty() {
                    continue;
                }
                let lower = line.to_ascii_lowercase();
                if !lower.contains("skill.md") && !line.contains("<timestamp>") {
                    continue;
                }
                let record: Value = match serde_json::from_str(line) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                let content_blocks = &record["message"]["content"];
                if record["role"] == "user" {
                    if let Some(parsed) = parse_cursor_timestamp_ms(&message_text(content_blocks)) {
                        ts = parsed;
                    }
                    continue;
                }
                if record["role"] != "assistant" {
                    continue;
                }
                let Some(blocks) = content_blocks.as_array() else {
                    continue;
                };
                for block in blocks {
                    if block["type"] != "tool_use" || block["name"] != "Read" {
                        continue;
                    }
                    let path = block["input"]["path"]
                        .as_str()
                        .or_else(|| block["input"]["file_path"].as_str())
                        .unwrap_or("");
                    let Some(skill) = skill_name_from_skill_md_path(path) else {
                        continue;
                    };
                    // One count per skill per transcript
                    if !seen.insert(skill.clone()) {
                        continue;
                    }
                    calls.push(SkillCall {
                        skill,
                        timestamp_ms: ts,
                        project: project.clone(),
                        session_id: session_id.clone(),
                        source: SOURCE.into(),
                        file: file.display().to_string(),
                    });
                }
            }
        }
    }

    calls
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::SystemTime;

    #[test]
    fn counts_read_of_skill_md_once_per_transcript() {
        assert_eq!(
            parse_cursor_timestamp_ms(
                "<timestamp>Tuesday, Oct 27, 2026, 10:39 PM (UTC+8)</timestamp>"
            ),
            Some(1_793_111_940_000)
        );
        assert_eq!(
            parse_cursor_timestamp_ms(
                "<timestamp>Thursday, Jan 1, 2026, 12:00 AM (UTC-5)</timestamp>"
            ),
            Some(1_767_243_600_000)
        );
        assert_eq!(
            parse_cursor_timestamp_ms(
                "<timestamp>Thursday, Jan 1, 2026, 12:00 PM (UTC-5)</timestamp>"
            ),
            Some(1_767_286_800_000)
        );

        let missing = collect_at("/nonexistent/skilled-cursor");
        assert!(!missing.available);
        assert!(missing.calls.is_empty());

        let root = std::env::temp_dir().join(format!(
            "skilled-cursor-rs-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let session = "11111111-2222-4333-8444-555555555555";
        let dir = root
            .join("Users-tester-code-skilled")
            .join("agent-transcripts")
            .join(session);
        fs::create_dir_all(&dir).unwrap();
        let body = r#"{"role":"user","message":{"content":[{"type":"text","text":"<timestamp>Tuesday, Oct 27, 2026, 10:39 PM (UTC+8)</timestamp>"}]}}
{"role":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"path":"/home/u/.cursor/skills/discipline/SKILL.md"}},{"type":"tool_use","name":"Read","input":{"path":"/home/u/.agents/skills/discipline/SKILL.md"}},{"type":"tool_use","name":"Read","input":{"path":"/home/u/docs/SKILL.md"}}]}}
"#;
        fs::write(dir.join(format!("{session}.jsonl")), body).unwrap();

        let result = collect_at(root.to_str().unwrap());
        assert!(result.available);
        assert_eq!(result.calls.len(), 1);
        let call = &result.calls[0];
        assert_eq!(call.skill, "discipline");
        assert_eq!(call.timestamp_ms, 1_793_111_940_000);
        assert_eq!(call.project, "Users-tester-code-skilled");
        assert_eq!(call.session_id, session);
        assert_eq!(call.source, "Cursor");
        assert!(!call.file.is_empty());
        let _ = fs::remove_dir_all(root);
    }
}
