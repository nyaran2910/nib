use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
pub struct FsChangedPayload {
    pub root: String,
    pub paths: Vec<String>,
}

struct WatchedEntry {
    _watcher: RecommendedWatcher,
    ref_count: usize,
}

/// Centralized, reference-counted directory watcher.
/// Opening the same directory in multiple windows reuses a single OS watcher.
pub struct WatcherManager {
    watchers: HashMap<PathBuf, WatchedEntry>,
}

impl WatcherManager {
    pub fn new() -> Self {
        Self {
            watchers: HashMap::new(),
        }
    }

    pub fn watch(&mut self, app: &AppHandle, root: &Path) -> Result<(), String> {
        let canonical = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
        if let Some(entry) = self.watchers.get_mut(&canonical) {
            entry.ref_count += 1;
            return Ok(());
        }

        let app_handle = app.clone();
        let root_str = canonical.to_string_lossy().to_string();

        let mut watcher = RecommendedWatcher::new(
            move |res: notify::Result<Event>| {
                if let Ok(event) = res {
                    let paths: Vec<String> = event
                        .paths
                        .into_iter()
                        .map(|p| p.to_string_lossy().to_string())
                        .collect();
                    if !paths.is_empty() {
                        let _ = app_handle.emit(
                            "fs:changed",
                            FsChangedPayload {
                                root: root_str.clone(),
                                paths,
                            },
                        );
                    }
                }
            },
            Config::default(),
        )
        .map_err(|e| format!("Failed to initialize file watcher: {e}"))?;

        watcher
            .watch(&canonical, RecursiveMode::Recursive)
            .map_err(|e| format!("Failed to watch directory: {e}"))?;

        self.watchers.insert(
            canonical,
            WatchedEntry {
                _watcher: watcher,
                ref_count: 1,
            },
        );
        Ok(())
    }

    pub fn unwatch(&mut self, root: &Path) {
        let canonical = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
        if let Some(entry) = self.watchers.get_mut(&canonical) {
            if entry.ref_count <= 1 {
                self.watchers.remove(&canonical);
            } else {
                entry.ref_count -= 1;
            }
        }
    }
}
