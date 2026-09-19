//! Skilled desktop: Tauri v2 shell around the `skilled-index` crate.
//! Local files only. No network, no telemetry.

mod data;
mod e2e;
mod settings;
mod watcher;

use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};

pub use data::{Reader, Snapshot};
pub use settings::Settings;

pub struct AppState {
    pub settings: Mutex<Settings>,
    pub config_dir: PathBuf,
    pub home: String,
    pub last: Mutex<Option<QuickStats>>,
    pub watcher: Mutex<Option<watcher::Watcher>>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QuickStats {
    pub calls: usize,
    pub skills: usize,
    pub projects: usize,
    pub sources: usize,
}

impl QuickStats {
    pub fn from_snapshot(s: &Snapshot) -> QuickStats {
        let mut skills = std::collections::HashSet::new();
        let mut projects = std::collections::HashSet::new();
        let mut sources = std::collections::HashSet::new();
        for c in &s.calls {
            skills.insert(c.skill.as_str());
            projects.insert(c.project.as_str());
            sources.insert(c.source.as_str());
        }
        QuickStats { calls: s.calls.len(), skills: skills.len(), projects: projects.len(), sources: sources.len() }
    }
    pub fn tooltip(&self) -> String {
        format!("Skilled — {} calls · {} skills · {} projects · {} sources", self.calls, self.skills, self.projects, self.sources)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub index_version: String,
    pub platform: String,
    pub config_dir: String,
    pub home: String,
    pub cli_available: bool,
}

// --- commands ----------------------------------------------------------------

#[tauri::command]
async fn snapshot(app: AppHandle, state: State<'_, AppState>, force: bool) -> Result<Snapshot, String> {
    let settings = state.settings.lock().map_err(|e| e.to_string())?.clone();
    let home = state.home.clone();
    let snap = tauri::async_runtime::spawn_blocking(move || data::load(&settings, &home, force))
        .await
        .map_err(|e| e.to_string())??;
    let stats = QuickStats::from_snapshot(&snap);
    *state.last.lock().map_err(|e| e.to_string())? = Some(stats.clone());
    update_tray(&app, &stats);
    Ok(snap)
}

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Result<Settings, String> {
    Ok(state.settings.lock().map_err(|e| e.to_string())?.clone())
}

#[tauri::command]
fn save_settings(app: AppHandle, state: State<'_, AppState>, settings: Settings) -> Result<Settings, String> {
    settings.save(&state.config_dir)?;
    *state.settings.lock().map_err(|e| e.to_string())? = settings.clone();
    restart_watcher(&app, &settings);
    apply_tray_visibility(&app, settings.show_tray);
    Ok(settings)
}

#[tauri::command]
fn app_info(app: AppHandle, state: State<'_, AppState>) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        index_version: skilled_index::VERSION.to_string(),
        platform: std::env::consts::OS.to_string(),
        config_dir: state.config_dir.display().to_string(),
        home: state.home.clone(),
        cli_available: data::cli_available(),
    }
}

/// Write export content chosen by the renderer. The path comes from the native
/// save dialog (dialog plugin) so the renderer never picks arbitrary paths.
#[tauri::command]
fn write_export(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| format!("write {path}: {e}"))
}

#[tauri::command]
fn path_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

// --- tray -------------------------------------------------------------------

const TRAY_ID: &str = "skilled-tray";

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn build_tray(app: &AppHandle, stats: Option<&QuickStats>) -> tauri::Result<()> {
    let s = stats.cloned().unwrap_or(QuickStats { calls: 0, skills: 0, projects: 0, sources: 0 });
    let calls = MenuItem::with_id(app, "stat-calls", format!("{} calls", s.calls), false, None::<&str>)?;
    let skills = MenuItem::with_id(app, "stat-skills", format!("{} skills · {} projects", s.skills, s.projects), false, None::<&str>)?;
    let show = MenuItem::with_id(app, "show", "Show Skilled", true, None::<&str>)?;
    let refresh = MenuItem::with_id(app, "refresh", "Refresh now", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&calls, &skills, &PredefinedMenuItem::separator(app)?, &show, &refresh, &PredefinedMenuItem::separator(app)?, &quit])?;

    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_menu(Some(menu))?;
        tray.set_tooltip(Some(s.tooltip()))?;
        return Ok(());
    }

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip(s.tooltip())
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "refresh" => {
                show_main(app);
                let _ = app.emit("skilled://command", "refresh");
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

fn update_tray(app: &AppHandle, stats: &QuickStats) {
    if app.tray_by_id(TRAY_ID).is_some() {
        let _ = build_tray(app, Some(stats));
    }
}

fn apply_tray_visibility(app: &AppHandle, show: bool) {
    match (show, app.tray_by_id(TRAY_ID)) {
        (true, None) => {
            let stats = app.state::<AppState>().last.lock().ok().and_then(|l| l.clone());
            let _ = build_tray(app, stats.as_ref());
        }
        (false, Some(_)) => {
            let _ = app.remove_tray_by_id(TRAY_ID);
        }
        _ => {}
    }
}

// --- watcher ----------------------------------------------------------------

fn restart_watcher(app: &AppHandle, settings: &Settings) {
    let state = app.state::<AppState>();
    let mut slot = match state.watcher.lock() {
        Ok(s) => s,
        Err(_) => return,
    };
    *slot = None; // drops the old watcher
    if !settings.watch_files {
        return;
    }
    let paths: Vec<PathBuf> = skilled_index::locations(&state.home, &settings.paths.to_provider_paths())
        .into_iter()
        .map(|l| PathBuf::from(l.path))
        .collect();
    let handle = app.clone();
    *slot = watcher::Watcher::start(paths, move || {
        let _ = handle.emit("skilled://files-changed", ());
    });
}

// --- app --------------------------------------------------------------------

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            let config_dir = app.path().app_config_dir().unwrap_or_else(|_| PathBuf::from(skilled_index::home_dir()).join(".skilled"));
            let settings = Settings::load(&config_dir);
            let home = skilled_index::home_dir();
            app.manage(AppState {
                settings: Mutex::new(settings.clone()),
                config_dir,
                home,
                last: Mutex::new(None),
                watcher: Mutex::new(None),
            });
            let handle = app.handle().clone();
            if e2e::dir().is_some() {
                return Ok(()); // harness: no tray, no watcher
            }
            if settings.show_tray {
                build_tray(&handle, None)?;
            }
            restart_watcher(&handle, &settings);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let state = app.state::<AppState>();
                let close_to_tray = state.settings.lock().map(|s| s.close_to_tray && s.show_tray).unwrap_or(false);
                if close_to_tray && app.tray_by_id(TRAY_ID).is_some() {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![snapshot, get_settings, save_settings, app_info, write_export, path_exists, quit, e2e::e2e_enabled, e2e::e2e_shot, e2e::e2e_report])
        .run(tauri::generate_context!())
        .expect("error while running Skilled");
}
