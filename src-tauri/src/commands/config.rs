use crate::core::config::{
    folder_config_file, global_config_file, load_effective_config, local_state_file,
    save_global_config as write_global_config, save_local_state as write_local_state, AppConfig,
    ConfigPathsInfo, LocalState,
};
use crate::state::AppState;
use std::path::Path;
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub fn get_config(
    state: State<'_, AppState>,
    folder_path: Option<String>,
) -> Result<AppConfig, String> {
    let cfg = load_effective_config(folder_path.as_deref().map(Path::new))?;
    if folder_path.is_none() {
        if let Ok(mut guard) = state.config.write() {
            *guard = cfg.clone();
        }
    }
    Ok(cfg)
}

#[tauri::command]
pub fn save_global_config(
    app: AppHandle,
    state: State<'_, AppState>,
    config: AppConfig,
) -> Result<(), String> {
    write_global_config(&config)?;
    if let Ok(mut guard) = state.config.write() {
        *guard = config.clone();
    }
    // Broadcast updated config to all open windows so every WebView stays in sync
    let _ = app.emit("config:updated", config);
    Ok(())
}

#[tauri::command]
pub fn get_config_paths(folder_path: Option<String>) -> ConfigPathsInfo {
    ConfigPathsInfo {
        global_config_file: global_config_file().to_string_lossy().to_string(),
        local_state_file: local_state_file().to_string_lossy().to_string(),
        folder_config_file: folder_path
            .as_deref()
            .map(|f| folder_config_file(Path::new(f)).to_string_lossy().to_string()),
    }
}

#[tauri::command]
pub fn get_local_state(state: State<'_, AppState>) -> LocalState {
    state
        .local_state
        .read()
        .map(|s| s.clone())
        .unwrap_or_default()
}

#[tauri::command]
pub fn save_local_state(state: State<'_, AppState>, local_state: LocalState) -> Result<(), String> {
    write_local_state(&local_state)?;
    if let Ok(mut guard) = state.local_state.write() {
        *guard = local_state;
    }
    Ok(())
}
