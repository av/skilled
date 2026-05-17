use std::collections::HashSet;
use std::path::Path;

use rusqlite::Connection;
use serde_json::Value;

use crate::model::{ProviderResult, SkillCall};

const SOURCE: &str = "OpenCode";

const BUILTINS: &[&str] = &[
    "bash", "compact", "help", "model", "config", "exit", "clear", "status", "version", "approve",
    "settings", "list",
];

pub fn collect(home: &str) -> ProviderResult {
    let db_path = format!("{home}/.local/share/opencode/opencode.db");
    let available = Path::new(&db_path).exists();

    if !available {
        return ProviderResult {
            name: SOURCE.into(),
            available: false,
            calls: vec![],
        };
    }

    let builtins: HashSet<&str> = BUILTINS.iter().copied().collect();
    let mut calls = Vec::new();

    let conn = match Connection::open_with_flags(
        &db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ) {
        Ok(c) => c,
        Err(_) => {
            return ProviderResult {
                name: SOURCE.into(),
                available: true,
                calls: vec![],
            };
        }
    };

    let mut stmt = match conn.prepare(
        "SELECT p.data, s.directory, p.session_id
         FROM part p
         JOIN session s ON p.session_id = s.id
         WHERE json_extract(p.data, '$.type') = 'tool'
           AND json_extract(p.data, '$.tool') = 'skill'",
    ) {
        Ok(s) => s,
        Err(_) => {
            return ProviderResult {
                name: SOURCE.into(),
                available: true,
                calls: vec![],
            };
        }
    };

    let rows = match stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    }) {
        Ok(r) => r,
        Err(_) => {
            return ProviderResult {
                name: SOURCE.into(),
                available: true,
                calls: vec![],
            };
        }
    };

    for row in rows.flatten() {
        let (data_str, directory, session_id) = row;

        let data: Value = match serde_json::from_str(&data_str) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let state = &data["state"];
        if state["status"].as_str() != Some("completed") {
            continue;
        }

        let skill = match state["input"]["name"].as_str() {
            Some(s) if !s.is_empty() && !builtins.contains(s) => s,
            _ => continue,
        };

        let ts = state["time"]["start"]
            .as_str()
            .and_then(super::claude_code::parse_iso_ms)
            .or_else(|| state["time"]["start"].as_i64())
            .unwrap_or(0);

        calls.push(SkillCall {
            skill: skill.to_string(),
            timestamp_ms: ts,
            project: directory,
            session_id,
            source: SOURCE.into(),
        });
    }

    ProviderResult {
        name: SOURCE.into(),
        available,
        calls,
    }
}
