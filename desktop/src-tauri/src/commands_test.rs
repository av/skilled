//! Tauri command tests: build the real app (state, setup, invoke handler) on
//! `tauri::test::MockRuntime` and call every command through the IPC layer,
//! exactly as the renderer's `invoke()` does. Runs headless; no window is shown.

use crate::{configure, AppState, Settings};
use serde::de::DeserializeOwned;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, MockRuntime, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{App, Manager, WebviewWindow, WebviewWindowBuilder};

// Tests share the process environment (HOME / SKILLED_CONFIG_DIR): serialize them.
static ENV: Mutex<()> = Mutex::new(());

struct Harness {
    _app: App<MockRuntime>,
    webview: WebviewWindow<MockRuntime>,
    home: PathBuf,
    config: PathBuf,
    _guard: std::sync::MutexGuard<'static, ()>,
}

fn fixture_copy(tag: &str) -> PathBuf {
    let src = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/home");
    let dst = std::env::temp_dir().join(format!("skilled-cmd-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dst);
    copy_dir(&src, &dst);
    dst
}

fn copy_dir(src: &std::path::Path, dst: &std::path::Path) {
    std::fs::create_dir_all(dst).unwrap();
    for entry in std::fs::read_dir(src).unwrap() {
        let entry = entry.unwrap();
        let to = dst.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&entry.path(), &to);
        } else {
            std::fs::copy(entry.path(), to).unwrap();
        }
    }
}

fn harness(tag: &str) -> Harness {
    let guard = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let home = fixture_copy(tag);
    let config = home.join("config");
    std::env::set_var("HOME", &home);
    std::env::set_var("USERPROFILE", &home);
    std::env::set_var("SKILLED_CONFIG_DIR", &config);
    std::env::remove_var("SKILLED_E2E_DIR");
    let mut app = configure(mock_builder()).build(mock_context(noop_assets())).expect("app builds on the mock runtime");
    // tauri runs the setup hook (state, watcher) on the first event-loop iteration.
    app.run_iteration(|_, _| {});
    let webview = WebviewWindowBuilder::new(&app, "main", Default::default()).build().expect("mock webview");
    Harness { _app: app, webview, home, config, _guard: guard }
}

impl Drop for Harness {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.home);
    }
}

impl Harness {
    /// Invoke a command like `invoke(cmd, args)` from `@tauri-apps/api/core`.
    fn invoke<T: DeserializeOwned>(&self, cmd: &str, args: serde_json::Value) -> Result<T, serde_json::Value> {
        get_ipc_response(
            &self.webview,
            InvokeRequest {
                cmd: cmd.into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                // The webview's own origin (local): tauri://localhost on macOS/Linux,
                // http://tauri.localhost on Windows/Android. Remote origins hit the ACL.
                url: (if cfg!(any(windows, target_os = "android")) { "http://tauri.localhost" } else { "tauri://localhost" }).parse().unwrap(),
                body: InvokeBody::Json(args),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
        )
        .map(|body| body.deserialize::<T>().expect("command response deserializes"))
    }
}

#[test]
fn snapshot_indexes_the_home_in_process_and_updates_quick_stats() {
    let h = harness("snapshot");
    let snap: crate::Snapshot = h.invoke("snapshot", serde_json::json!({ "force": true })).unwrap();
    assert!(matches!(snap.reader, crate::Reader::RustIndex), "reader: {:?}", snap.reader);
    assert!(snap.calls.len() > 10, "fixture calls: {}", snap.calls.len());
    let skills: std::collections::HashSet<&str> = snap.calls.iter().map(|c| c.skill.as_str()).collect();
    for s in ["review", "commit", "bugbash", "facts"] {
        assert!(skills.contains(s), "missing fixture skill {s}");
    }
    assert!(snap.calls.iter().all(|c| !c.file.is_empty()), "every call carries its source file");
    assert!(snap.providers.iter().filter(|p| p.available).count() == 5, "all five providers detected: {:?}", snap.providers);
    assert!(h.home.join(".skilled/index.db").exists(), "index written under the app's HOME");

    let state = h._app.state::<AppState>();
    let last = state.last.lock().unwrap().clone().expect("quick stats cached for the tray");
    assert_eq!(last.calls, snap.calls.len());
    assert!(last.skills >= 4 && last.sources == 5);

    // Second call without force reuses the fresh index (no re-parse).
    let again: crate::Snapshot = h.invoke("snapshot", serde_json::json!({ "force": false })).unwrap();
    assert!(!again.reindexed, "fresh index is reused");
    assert_eq!(again.calls.len(), snap.calls.len());
}

#[test]
fn settings_round_trip_through_ipc_and_persist_to_config_dir() {
    let h = harness("settings");
    let s: Settings = h.invoke("get_settings", serde_json::json!({})).unwrap();
    assert_eq!(s, Settings::default());

    let mut edited = s.clone();
    edited.refresh_interval_secs = 42;
    edited.noise_skills = vec!["clear".into()];
    edited.show_tray = false;
    edited.watch_files = false;
    let saved: Settings = h.invoke("save_settings", serde_json::json!({ "settings": edited })).unwrap();
    assert_eq!(saved, edited);
    assert_eq!(Settings::load(&h.config), edited, "written to SKILLED_CONFIG_DIR");
    let now: Settings = h.invoke("get_settings", serde_json::json!({})).unwrap();
    assert_eq!(now, edited);
    assert!(h._app.state::<AppState>().watcher.lock().unwrap().is_none(), "watch_files=false stops the watcher");

    edited.watch_files = true;
    let _: Settings = h.invoke("save_settings", serde_json::json!({ "settings": edited })).unwrap();
    assert!(h._app.state::<AppState>().watcher.lock().unwrap().is_some(), "watch_files=true restarts it on the fixture dirs");
}

#[test]
fn app_info_reports_versions_paths_and_platform() {
    let h = harness("info");
    let info: serde_json::Value = h.invoke("app_info", serde_json::json!({})).unwrap();
    assert_eq!(info["indexVersion"], skilled_index::VERSION);
    assert_eq!(info["platform"], std::env::consts::OS);
    assert_eq!(info["home"].as_str(), Some(h.home.to_string_lossy().as_ref()));
    assert_eq!(info["configDir"].as_str(), Some(h.config.to_string_lossy().as_ref()));
    assert!(info["cliAvailable"].is_boolean());
}

#[test]
fn write_export_and_path_exists() {
    let h = harness("export");
    let path = h.home.join("skills.csv");
    let exists: bool = h.invoke("path_exists", serde_json::json!({ "path": path })).unwrap();
    assert!(!exists);
    let _: () = h.invoke("write_export", serde_json::json!({ "path": path, "content": "skill,count\nreview,3\n" })).unwrap();
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "skill,count\nreview,3\n");
    let exists: bool = h.invoke("path_exists", serde_json::json!({ "path": path })).unwrap();
    assert!(exists);

    let err = h.invoke::<()>("write_export", serde_json::json!({ "path": h.home.join("missing/dir/x.json"), "content": "{}" })).unwrap_err();
    assert!(err.to_string().contains("write "), "error names the path: {err}");
}

#[test]
fn e2e_commands_are_inert_outside_harness_mode() {
    let h = harness("e2e");
    let cfg: serde_json::Value = h.invoke("e2e_config", serde_json::json!({})).unwrap();
    assert_eq!(cfg["enabled"], false);
    for (cmd, args) in [
        ("e2e_append_call", serde_json::json!({ "skill": "x" })),
        ("e2e_shot", serde_json::json!({ "name": "x" })),
        ("e2e_record", serde_json::json!({ "start": true, "fps": 1 })),
    ] {
        let err = h.invoke::<serde_json::Value>(cmd, args).unwrap_err();
        assert_eq!(err, "not in e2e mode", "{cmd} refuses outside e2e mode");
    }
    assert!(!h.home.join(".claude/history.jsonl").read_ends_with("/x now"), "nothing appended");
}

trait ReadEndsWith {
    fn read_ends_with(&self, needle: &str) -> bool;
}
impl ReadEndsWith for PathBuf {
    fn read_ends_with(&self, needle: &str) -> bool {
        std::fs::read_to_string(self).map(|s| s.trim_end().ends_with(needle)).unwrap_or(false)
    }
}

#[test]
fn unknown_command_is_rejected() {
    let h = harness("unknown");
    let err = h.invoke::<serde_json::Value>("read_arbitrary_file", serde_json::json!({ "path": "/etc/passwd" })).unwrap_err();
    assert!(err.to_string().contains("not found") || err.to_string().contains("read_arbitrary_file"), "{err}");
}
