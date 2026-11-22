use crate::core::config::{load_effective_config, load_local_state, AppConfig, LocalState};
use crate::core::images::ImageRefManager;
use crate::core::search::SearchIndex;
use crate::core::watcher::WatcherManager;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, RwLock};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WindowLaunchTarget {
    pub root_dir: Option<String>,
    pub file_path: Option<String>,
}

/// Centralized application state managed once by Tauri across all WebView windows.
/// Adding more windows never duplicates watchers, search indices, or config loaders.
pub struct AppState {
    pub config: RwLock<AppConfig>,
    pub local_state: RwLock<LocalState>,
    pub watchers: Mutex<WatcherManager>,
    pub search_index: RwLock<SearchIndex>,
    pub image_refs: Mutex<ImageRefManager>,
    pub window_targets: Mutex<HashMap<String, WindowLaunchTarget>>,
}

impl AppState {
    pub fn new() -> Self {
        let config = load_effective_config(None).unwrap_or_default();
        let local_state = load_local_state();
        Self {
            config: RwLock::new(config),
            local_state: RwLock::new(local_state),
            watchers: Mutex::new(WatcherManager::new()),
            search_index: RwLock::new(SearchIndex::new()),
            image_refs: Mutex::new(ImageRefManager::new()),
            window_targets: Mutex::new(HashMap::new()),
        }
    }
}
