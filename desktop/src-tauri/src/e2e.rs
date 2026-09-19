//! End-to-end harness. Only active when `SKILLED_E2E_DIR` is set: the renderer
//! drives itself through every view, asks us to snapshot each one
//! (`e2e_shot`, WebKitGTK-native on Linux), then posts a report (`e2e_report`)
//! and the app exits. Nothing here runs in a normal session.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

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
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ViewReport {
    pub view: String,
    pub headings: Vec<String>,
    pub text_length: usize,
}

#[tauri::command]
pub fn e2e_enabled() -> bool {
    dir().is_some()
}

/// Snapshot the visible webview to `<dir>/<name>.png`. Returns false when the
/// platform cannot snapshot (non-Linux); the report is still produced.
#[tauri::command]
pub async fn e2e_shot(app: AppHandle, name: String) -> Result<bool, String> {
    let dir = dir().ok_or("not in e2e mode")?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let safe: String = name.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
    let path = dir.join(format!("{safe}.png"));
    snapshot(&app, path).await
}

#[cfg(target_os = "linux")]
async fn snapshot(app: &AppHandle, path: PathBuf) -> Result<bool, String> {
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
async fn snapshot(_app: &AppHandle, _path: PathBuf) -> Result<bool, String> {
    Ok(false)
}

/// Receives the renderer's report and exits the app.
#[tauri::command]
pub fn e2e_report(app: AppHandle, report: Report) -> Result<(), String> {
    let dir = dir().ok_or("not in e2e mode")?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::write(dir.join("report.json"), serde_json::to_string_pretty(&report).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(300));
        handle.exit(0);
    });
    Ok(())
}
