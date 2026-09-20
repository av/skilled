//! End-to-end harness. Only active when `SKILLED_E2E_DIR` is set: the renderer
//! drives itself through every view, asks us to snapshot each one
//! (`e2e_shot`, WebKitGTK-native on Linux), then posts a report (`e2e_report`)
//! and the app exits. Nothing here runs in a normal session.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
#[cfg(target_os = "linux")]
use tauri::Manager;

pub fn dir() -> Option<PathBuf> {
    std::env::var_os("SKILLED_E2E_DIR").map(PathBuf::from)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Report {
    pub views: Vec<ViewReport>,
    pub calls: usize,
    pub skills: Vec<String>,
    pub reader: String,
    pub errors: Vec<String>,
    /// Calls visible after `e2e_append_call` wrote a new history line and the
    /// watcher → `skilled://files-changed` → refresh path re-indexed (None if skipped).
    #[serde(default)]
    pub live_calls: Option<usize>,
}

/// Append one real Claude Code history line (skill `live-update`) to
/// `$HOME/.claude/history.jsonl`, exactly as the CLI writes it, so the running
/// app has to notice it through the file watcher. Only in e2e mode.
#[tauri::command]
pub fn e2e_append_call(skill: String) -> Result<String, String> {
    dir().ok_or("not in e2e mode")?;
    let safe: String = skill.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
    let path = std::path::PathBuf::from(skilled_index::home_dir()).join(".claude").join("history.jsonl");
    let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_millis();
    let line = format!("{{\"display\":\"/{safe} now\",\"timestamp\":{ts},\"project\":\"/home/tester/code/skilled\",\"sessionId\":\"live-{ts}\"}}\n");
    use std::io::Write;
    let mut f = fs::OpenOptions::new().append(true).create(true).open(&path).map_err(|e| e.to_string())?;
    f.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ViewReport {
    pub view: String,
    pub headings: Vec<String>,
    pub text_length: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub enabled: bool,
    /// ms to dwell on each view before capturing (SKILLED_E2E_DWELL_MS, default 900).
    pub dwell_ms: u64,
    /// SKILLED_E2E_RECORD=1 adds an interactive tour for screen recordings.
    pub record: bool,
}

#[tauri::command]
pub fn e2e_config() -> Config {
    Config {
        enabled: dir().is_some(),
        dwell_ms: std::env::var("SKILLED_E2E_DWELL_MS").ok().and_then(|v| v.parse().ok()).unwrap_or(900),
        record: std::env::var("SKILLED_E2E_RECORD").map(|v| v == "1").unwrap_or(false),
    }
}

/// Snapshot the visible webview to `<dir>/<name>.png`. Returns false when the
/// platform cannot snapshot (non-Linux); the report is still produced.
#[tauri::command]
pub async fn e2e_shot<R: tauri::Runtime>(app: AppHandle<R>, name: String) -> Result<bool, String> {
    let dir = dir().ok_or("not in e2e mode")?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let safe: String = name.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
    let path = dir.join(format!("{safe}.png"));
    snapshot(&app, path).await
}

#[cfg(target_os = "linux")]
async fn snapshot<R: tauri::Runtime>(app: &AppHandle<R>, path: PathBuf) -> Result<bool, String> {
    use webkit2gtk::{SnapshotOptions, SnapshotRegion, WebViewExt};
    let window = app.get_webview_window("main").ok_or("no main window")?;
    let (tx, rx) = tauri::async_runtime::channel::<Result<(), String>>(1);
    window
        .with_webview(move |wv| {
            let webview = wv.inner();
            let tx = tx.clone();
            webview.snapshot(SnapshotRegion::Visible, SnapshotOptions::NONE, None::<&webkit2gtk::gio::Cancellable>, move |res| {
                let out = res.map_err(|e| e.to_string()).and_then(|surface| {
                    let mut file = fs::File::create(&path).map_err(|e| e.to_string())?;
                    surface.write_to_png(&mut file).map_err(|e| e.to_string())
                });
                let _ = tx.blocking_send(out);
            });
        })
        .map_err(|e| e.to_string())?;
    let mut rx = rx;
    match rx.recv().await {
        Some(Ok(())) => Ok(true),
        Some(Err(e)) => Err(e),
        None => Err("snapshot callback dropped".into()),
    }
}

#[cfg(not(target_os = "linux"))]
async fn snapshot<R: tauri::Runtime>(_app: &AppHandle<R>, _path: PathBuf) -> Result<bool, String> {
    Ok(false)
}

/// Start/stop a frame grabber for recordings (Linux only; no-op elsewhere).
/// Frames land in `<dir>/frames/00001.png …` at roughly `fps`.
#[tauri::command]
pub async fn e2e_record<R: tauri::Runtime>(app: AppHandle<R>, start: bool, fps: u32) -> Result<bool, String> {
    let dir = dir().ok_or("not in e2e mode")?;
    if !start {
        RECORDING.store(false, std::sync::atomic::Ordering::SeqCst);
        return Ok(true);
    }
    if !cfg!(target_os = "linux") {
        return Ok(false);
    }
    let frames = dir.join("frames");
    fs::create_dir_all(&frames).map_err(|e| e.to_string())?;
    RECORDING.store(true, std::sync::atomic::Ordering::SeqCst);
    let interval = std::time::Duration::from_millis(1000 / fps.clamp(1, 30) as u64);
    tauri::async_runtime::spawn(async move {
        let mut n = 0u32;
        while RECORDING.load(std::sync::atomic::Ordering::SeqCst) {
            n += 1;
            let _ = snapshot(&app, frames.join(format!("{n:05}.png"))).await;
            tokio_sleep(interval).await;
        }
    });
    Ok(true)
}

static RECORDING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

async fn tokio_sleep(d: std::time::Duration) {
    // tauri's async runtime is tokio; avoid adding tokio as a direct dependency.
    let (tx, rx) = tauri::async_runtime::channel::<()>(1);
    std::thread::spawn(move || { std::thread::sleep(d); let _ = tx.blocking_send(()); });
    let mut rx = rx;
    let _ = rx.recv().await;
}

/// Receives the renderer's report and exits the app.
#[tauri::command]
pub fn e2e_report<R: tauri::Runtime>(app: AppHandle<R>, report: Report) -> Result<(), String> {
    let dir = dir().ok_or("not in e2e mode")?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::write(dir.join("report.json"), serde_json::to_string_pretty(&report).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    RECORDING.store(false, std::sync::atomic::Ordering::SeqCst);
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(400));
        handle.exit(0);
    });
    Ok(())
}
