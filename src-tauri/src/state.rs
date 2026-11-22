use crate::core::config::{load_effective_config, load_local_state, AppConfig, LocalState};
use crate::core::images::ImageRefManager;
use crate::core::search::SearchIndex;
use crate::core::sessions::SessionManager;
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
/// Acts as the in-process tmux-style session server + shared watcher/search core.
pub struct AppState {
    pub config: RwLock<AppConfig>,
    pub local_state: RwLock<LocalState>,
    pub watchers: Mutex<WatcherManager>,
    pub search_index: RwLock<SearchIndex>,
    pub image_refs: Mutex<ImageRefManager>,
    pub sessions: Mutex<SessionManager>,
    pub window_targets: Mutex<HashMap<String, WindowLaunchTarget>>,
}

impl AppState {
    pub fn new() -> Self {
        let config = load_effective_config(None).unwrap_or_default();
        let local_state = load_local_state();
        let sessions = SessionManager::load();
        Self {
            config: RwLock::new(config),
            local_state: RwLock::new(local_state),
            watchers: Mutex::new(WatcherManager::new()),
            search_index: RwLock::new(SearchIndex::new()),
            image_refs: Mutex::new(ImageRefManager::new()),
            sessions: Mutex::new(sessions),
            window_targets: Mutex::new(HashMap::new()),
        }
    }
}
