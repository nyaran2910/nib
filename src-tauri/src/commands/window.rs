use crate::core::config::expand_tilde;
use crate::state::{AppState, WindowLaunchTarget};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager, State, TitleBarStyle, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// Opens a brand-new independent full Nib window (with its own sidebar + editor).
/// Multiple windows share the same Rust `AppState` (watchers, search index, config).
#[tauri::command]
pub fn open_new_window(
    app: AppHandle,
    state: State<'_, AppState>,
    root_dir: Option<String>,
    file_path: Option<String>,
) -> Result<String, String> {
    spawn_window(&app, &state, root_dir, file_path)
}

pub fn spawn_window(
    app: &AppHandle,
    state: &AppState,
    root_dir: Option<String>,
    file_path: Option<String>,
) -> Result<String, String> {
    let label = format!("nib-win-{}", uuid::Uuid::new_v4().simple());

    // If only a single .md file is given, derive its parent folder as the sidebar root
    let resolved_root = root_dir.or_else(|| {
        file_path
            .as_deref()
            .and_then(|fp| PathBuf::from(fp).parent().map(|p| p.to_string_lossy().to_string()))
    });

    if let Ok(mut targets) = state.window_targets.lock() {
        targets.insert(
            label.clone(),
            WindowLaunchTarget {
                root_dir: resolved_root,
                file_path,
            },
        );
    }

    let mut builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title("Nib")
        .inner_size(1120.0, 760.0)
        .min_inner_size(640.0, 420.0);

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(TitleBarStyle::Overlay)
            .hidden_title(true);
    }

    builder
        .build()
        .map_err(|e| format!("Failed to create window: {e}"))?;

    Ok(label)
}

#[tauri::command]
pub fn get_window_launch_target(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> WindowLaunchTarget {
    let label = window.label().to_string();
    if let Ok(targets) = state.window_targets.lock() {
        if let Some(target) = targets.get(&label) {
            return target.clone();
        }
    }

    // Fallback to default_directory from ~/.config/nib/config.toml (expanding `~`)
    let default_dir = state
        .config
        .read()
        .ok()
        .and_then(|c| c.default_directory.clone())
        .map(|raw| expand_tilde(&raw).to_string_lossy().to_string());

    WindowLaunchTarget {
        root_dir: default_dir,
        file_path: None,
    }
}

pub fn emit_to_focused_window(app: &AppHandle, event: &str) {
    for (_label, win) in app.webview_windows() {
        if win.is_focused().unwrap_or(false) {
            let _ = win.emit(event, ());
            return;
        }
    }
    if let Some((_, win)) = app.webview_windows().into_iter().next() {
        let _ = win.emit(event, ());
    }
}
