use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::sync::OnceLock;

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

fn skill_md_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)(?:^|/)skills/([^/]+)/SKILL\.md$").unwrap())
}

/// If `file_path` is a skill playbook (`…/skills/<name>/SKILL.md`), return `<name>`.
fn skill_name_from_skill_md_path(file_path: &str) -> Option<String> {
    if file_path.is_empty() {
        return None;
    }
    let normalized = file_path.replace('\\', "/");
    skill_md_re()
        .captures(&normalized)
        .and_then(|c| c.get(1).map(|m| m.as_str().to_string()))
}

fn grok_tool_name(update: &Value) -> &str {
    update["_meta"]["x.ai/tool"]["name"]
        .as_str()
        .or_else(|| update["title"].as_str())
        .unwrap_or("")
}

fn grok_tool_path(update: &Value) -> String {
    update["rawInput"]["target_file"]
        .as_str()
        .or_else(|| update["rawInput"]["path"].as_str())
        .or_else(|| update["_meta"]["x.ai/tool"]["input"]["path"].as_str())
        .unwrap_or("")
        .to_string()
}

fn record_timestamp_ms(record: &Value) -> i64 {
    record["timestamp"]
        .as_f64()
        .map(|f| (f * 1000.0) as i64)
        .or_else(|| record["timestamp"].as_i64().map(|n| n * 1000))
        .unwrap_or(0)
}

fn parse_tool_args(args: &Value) -> Value {
    match args {
        Value::String(s) => serde_json::from_str(s).unwrap_or(Value::Null),
        other => other.clone(),
    }
}

fn push_skill(
    calls: &mut Vec<SkillCall>,
    seen: &mut HashSet<String>,
    builtins: &HashSet<&str>,
    skill: &str,
    timestamp_ms: i64,
    project: &str,
    session_id: &str,
    file: &str,
) {
    if skill.is_empty() || builtins.contains(skill) || seen.contains(skill) {
        return;
    }
    seen.insert(skill.to_string());
    calls.push(SkillCall {
        skill: skill.to_string(),
        timestamp_ms,
        project: project.to_string(),
        session_id: session_id.to_string(),
        source: SOURCE.into(),
        file: file.to_string(),
    });
}

pub fn default_root(home: &str) -> String {
    format!("{home}/.grok/sessions")
}

pub fn collect(home: &str) -> ProviderResult {
    collect_at(&default_root(home))
}

pub fn collect_at(sessions_dir: &str) -> ProviderResult {
    let available = Path::new(sessions_dir).is_dir();

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
        calls: collect_from_dir(sessions_dir),
    }
}

fn collect_from_dir(sessions_dir: &str) -> Vec<SkillCall> {
    let builtins: HashSet<&str> = BUILTINS.iter().copied().collect();
    let cmd_re = Regex::new(r"<command-name>([^<]+)</command-name>").unwrap();
    let mut calls = Vec::new();

    let project_dirs = match fs::read_dir(sessions_dir) {
        Ok(d) => d,
        Err(_) => return calls,
    };

    for proj_entry in project_dirs.flatten() {
        let dir_name = proj_entry.file_name().to_string_lossy().to_string();
        if !dir_name.starts_with("%2F") {
            continue;
        }

        let project = urlencoding::decode(&dir_name)
            .map(|s| s.into_owned())
            .unwrap_or_else(|_| dir_name.clone());
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
                        if update.is_null() {
                            continue;
                        }

                        let session_id = record["params"]["sessionId"]
                            .as_str()
                            .unwrap_or(&session_dir_name);
                        let ts = record_timestamp_ms(&record);
                        let session_update = update["sessionUpdate"].as_str();

                        if session_update == Some("user_message_chunk") {
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
                                calls.push(SkillCall {
                                    skill: skill.to_string(),
                                    timestamp_ms: ts,
                                    project: project.clone(),
                                    session_id: session_id.to_string(),
                                    source: SOURCE.into(),
                                    file: updates_path.display().to_string(),
                                });
                            }
                            continue;
                        }

                        if session_update == Some("tool_call") {
                            if grok_tool_name(update) != "read_file" {
                                continue;
                            }
                            if let Some(skill) =
                                skill_name_from_skill_md_path(&grok_tool_path(update))
                            {
                                push_skill(
                                    &mut calls, &mut seen, &builtins, &skill, ts, &project,
                                    session_id, &updates_path.display().to_string(),
                                );
                            }
                        }
                    }
                }
            }

            let chat_path = session_entry.path().join("chat_history.jsonl");
            if chat_path.exists() {
                if let Ok(content) = fs::read_to_string(&chat_path) {
                    let session_ts = uuidv7_to_ms(&session_dir_name);

                    for line in content.lines() {
                        if line.trim().is_empty() {
                            continue;
                        }
                        let maybe_command = line.contains("command-name");
                        let maybe_skill_md = line.contains("SKILL.md");
                        if !maybe_command && !maybe_skill_md {
                            continue;
                        }

                        let record: Value = match serde_json::from_str(line) {
                            Ok(v) => v,
                            Err(_) => continue,
                        };

                        if record["type"].as_str() == Some("user") && maybe_command {
                            let text = match &record["content"] {
                                Value::String(s) => s.clone(),
                                Value::Array(arr) => arr
                                    .iter()
                                    .filter_map(|p| p["text"].as_str())
                                    .collect::<Vec<_>>()
                                    .join(""),
                                _ => continue,
                            };

                            if text.contains("<background_context>") {
                                continue;
                            }

                            for caps in cmd_re.captures_iter(&text) {
                                push_skill(
                                    &mut calls,
                                    &mut seen,
                                    &builtins,
                                    &caps[1],
                                    session_ts,
                                    &project,
                                    &session_dir_name,
                                    &chat_path.display().to_string(),
                                );
                            }
                            continue;
                        }

                        if record["type"].as_str() == Some("assistant")
                            && maybe_skill_md
                            && record["tool_calls"].is_array()
                        {
                            for tc in record["tool_calls"].as_array().unwrap() {
                                if tc["name"].as_str() != Some("read_file") {
                                    continue;
                                }
                                let args = parse_tool_args(&tc["arguments"]);
                                let path = args["target_file"]
                                    .as_str()
                                    .or_else(|| args["path"].as_str())
                                    .unwrap_or("");
                                if let Some(skill) = skill_name_from_skill_md_path(path) {
                                    push_skill(
                                        &mut calls,
                                        &mut seen,
                                        &builtins,
                                        &skill,
                                        session_ts,
                                        &project,
                                        &session_dir_name,
                                        &chat_path.display().to_string(),
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    calls
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;
    use std::path::{Path, PathBuf};

    fn tmp_sessions() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "skilled-grok-rs-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let session = dir
            .join("%2Ftmp%2Fdemo")
            .join("01a09a3f-dcf8-72d0-89dd-78d4a84d1d35");
        fs::create_dir_all(&session).unwrap();
        session
    }

    fn write(path: &Path, name: &str, body: &str) {
        let mut f = fs::File::create(path.join(name)).unwrap();
        f.write_all(body.as_bytes()).unwrap();
    }

    #[test]
    fn skill_name_from_directory_containing_skill_md() {
        assert_eq!(
            skill_name_from_skill_md_path("/home/u/.agents/skills/discipline/SKILL.md").as_deref(),
            Some("discipline")
        );
        assert_eq!(
            skill_name_from_skill_md_path("C:\\Users\\u\\.agents\\skills\\review\\SKILL.md")
                .as_deref(),
            Some("review")
        );
        assert_eq!(
            skill_name_from_skill_md_path("/home/u/.agents/skills/discipline/references/foo.md"),
            None
        );
        assert_eq!(skill_name_from_skill_md_path("/home/u/docs/SKILL.md"), None);
    }

    #[test]
    fn counts_read_file_of_skill_md() {
        let session = tmp_sessions();
        write(
            &session,
            "chat_history.jsonl",
            r#"{"type":"assistant","tool_calls":[{"name":"read_file","arguments":"{\"target_file\":\"/home/u/.agents/skills/discipline/SKILL.md\"}"}]}
"#,
        );
        let root = session.parent().unwrap().parent().unwrap();
        let calls = collect_from_dir(root.to_str().unwrap());
        assert_eq!(
            calls.iter().map(|c| c.skill.as_str()).collect::<Vec<_>>(),
            ["discipline"]
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn ignores_tool_call_update_duplicates() {
        let session = tmp_sessions();
        write(
            &session,
            "updates.jsonl",
            r#"{"timestamp":100,"params":{"update":{"sessionUpdate":"tool_call","title":"read_file","rawInput":{"target_file":"/s/skills/review/SKILL.md"},"_meta":{"x.ai/tool":{"name":"read_file"}}}}}
{"timestamp":101,"params":{"update":{"sessionUpdate":"tool_call_update","title":"Read","rawInput":{"target_file":"/s/skills/review/SKILL.md"},"_meta":{"x.ai/tool":{"name":"read_file"}}}}}
"#,
        );
        let root = session.parent().unwrap().parent().unwrap();
        let calls = collect_from_dir(root.to_str().unwrap());
        assert_eq!(
            calls.iter().map(|c| c.skill.as_str()).collect::<Vec<_>>(),
            ["review"]
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn dedups_project_and_global_skill_md_copies() {
        let session = tmp_sessions();
        write(
            &session,
            "chat_history.jsonl",
            r#"{"type":"assistant","tool_calls":[{"name":"read_file","arguments":"{\"target_file\":\"/repo/.agents/skills/overnight/SKILL.md\"}"}]}
{"type":"assistant","tool_calls":[{"name":"read_file","arguments":"{\"target_file\":\"/home/u/.agents/skills/overnight/SKILL.md\"}"}]}
"#,
        );
        let root = session.parent().unwrap().parent().unwrap();
        let calls = collect_from_dir(root.to_str().unwrap());
        assert_eq!(
            calls.iter().map(|c| c.skill.as_str()).collect::<Vec<_>>(),
            ["overnight"]
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn still_counts_slash_command_name_tags() {
        let session = tmp_sessions();
        write(
            &session,
            "chat_history.jsonl",
            r#"{"type":"user","content":"<command-name>bugbash</command-name>"}
"#,
        );
        let root = session.parent().unwrap().parent().unwrap();
        let calls = collect_from_dir(root.to_str().unwrap());
        assert_eq!(
            calls.iter().map(|c| c.skill.as_str()).collect::<Vec<_>>(),
            ["bugbash"]
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn skips_builtin_skill_md_loads() {
        let session = tmp_sessions();
        write(
            &session,
            "chat_history.jsonl",
            r#"{"type":"assistant","tool_calls":[{"name":"read_file","arguments":"{\"target_file\":\"/home/u/.grok/bundled/skills/help/SKILL.md\"}"}]}
"#,
        );
        let root = session.parent().unwrap().parent().unwrap();
        let calls = collect_from_dir(root.to_str().unwrap());
        assert!(calls.is_empty());
        let _ = fs::remove_dir_all(root);
    }
}
