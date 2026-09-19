//! Debounced watch over provider roots so the UI can refresh when a session
//! file changes. Missing roots are skipped; the watcher never creates files.

use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use std::path::PathBuf;
use std::time::Duration;

pub struct Watcher {
    _debouncer: Debouncer<notify::RecommendedWatcher>,
    pub watched: Vec<PathBuf>,
}

impl Watcher {
    /// Returns `None` when nothing could be watched.
    pub fn start<F: Fn() + Send + 'static>(paths: Vec<PathBuf>, on_change: F) -> Option<Watcher> {
        let mut debouncer = new_debouncer(Duration::from_millis(1500), move |res: DebounceEventResult| {
            if let Ok(events) = res {
                // Ignore SQLite journal churn from our own index and editors' temp files.
                let relevant = events.iter().any(|e| {
                    let p = e.path.to_string_lossy();
                    !(p.ends_with("-wal") || p.ends_with("-shm") || p.ends_with(".tmp") || p.contains("/.skilled/"))
                });
                if relevant {
                    on_change();
                }
            }
        })
        .ok()?;

        let mut watched = Vec::new();
        for p in paths {
            let target = if p.is_file() { p.parent().map(|d| d.to_path_buf()).unwrap_or(p.clone()) } else { p.clone() };
            if !target.exists() {
                continue;
            }
            if debouncer.watcher().watch(&target, RecursiveMode::Recursive).is_ok() {
                watched.push(p);
            }
        }
        if watched.is_empty() {
            return None;
        }
        Some(Watcher { _debouncer: debouncer, watched })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    #[test]
    fn fires_once_for_a_burst_of_writes() {
        let dir = std::env::temp_dir().join(format!("skilled-watch-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let hits = Arc::new(AtomicUsize::new(0));
        let h = hits.clone();
        let w = Watcher::start(vec![dir.clone(), PathBuf::from("/nonexistent/skilled")], move || {
            h.fetch_add(1, Ordering::SeqCst);
        })
        .expect("watcher starts on the existing dir");
        assert_eq!(w.watched.len(), 1);
        std::thread::sleep(Duration::from_millis(300));
        for i in 0..5 {
            std::fs::write(dir.join(format!("s{i}.jsonl")), "{}\n").unwrap();
        }
        std::thread::sleep(Duration::from_millis(3000));
        let n = hits.load(Ordering::SeqCst);
        assert!(n >= 1 && n <= 2, "debounced into 1-2 callbacks, got {n}");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
