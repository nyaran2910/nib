mod commands;
mod core;
mod providers;
mod state;

use commands::window::{emit_to_focused_window, spawn_window};
use state::{AppState, WindowLaunchTarget};
use std::path::PathBuf;
#[cfg(desktop)]
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::Manager;

fn resolve_cli_launch_target() -> Option<WindowLaunchTarget> {
    let arg = std::env::args().nth(1)?;
    if arg.starts_with('-') {
        return None;
    }
    let path = PathBuf::from(&arg);
    let resolved = path.canonicalize().unwrap_or(path);
    if resolved.is_dir() {
        Some(WindowLaunchTarget {
            root_dir: Some(resolved.to_string_lossy().to_string()),
            file_path: None,
        })
    } else if resolved.is_file() {
        let root_dir = resolved
            .parent()
            .map(|p| p.to_string_lossy().to_string());
        Some(WindowLaunchTarget {
            root_dir,
            file_path: Some(resolved.to_string_lossy().to_string()),
        })
    } else {
        None
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .setup(|app| {
            // Seed main window launch target from CLI argument (`nib <dir_or_file>`)
            if let Some(target) = resolve_cli_launch_target() {
                let state = app.state::<AppState>();
                if let Ok(mut targets) = state.window_targets.lock() {
                    targets.insert("main".to_string(), target);
                };
            }

            #[cfg(desktop)]
            {
                // Keep customizable actions in the menu bar WITHOUT hardcoded accelerators
                // so user-configured keybindings never double-fire or conflict with AppKit.
                let new_note = MenuItemBuilder::with_id("new_note", "New Note").build(app)?;
                let new_window = MenuItemBuilder::with_id("new_window", "New Window").build(app)?;
                let open_folder =
                    MenuItemBuilder::with_id("open_folder", "Open Folder...").build(app)?;
                let save_note = MenuItemBuilder::with_id("save_note", "Save").build(app)?;
                let open_settings =
                    MenuItemBuilder::with_id("open_settings", "Settings...").build(app)?;

                let command_palette =
                    MenuItemBuilder::with_id("command_palette", "Command Palette...").build(app)?;
                let search_omni =
                    MenuItemBuilder::with_id("search_omni", "Omni Search...").build(app)?;
                let search_files =
                    MenuItemBuilder::with_id("search_files", "Find File...").build(app)?;
                let search_content =
                    MenuItemBuilder::with_id("search_content", "Search in Notes...").build(app)?;
                let search_tags =
                    MenuItemBuilder::with_id("search_tags", "Search by Tag...").build(app)?;

                let toggle_sidebar =
                    MenuItemBuilder::with_id("toggle_sidebar", "Toggle Sidebar").build(app)?;
                let toggle_vim =
                    MenuItemBuilder::with_id("toggle_vim", "Toggle Vim Mode").build(app)?;
                let toggle_render =
                    MenuItemBuilder::with_id("toggle_render", "Toggle Markdown Rendering")
                        .build(app)?;

                let app_submenu = SubmenuBuilder::new(app, "Nib")
                    .about(None)
                    .separator()
                    .item(&open_settings)
                    .separator()
                    .services()
                    .separator()
                    .hide()
                    .hide_others()
                    .show_all()
                    .separator()
                    .quit()
                    .build()?;

                let file_submenu = SubmenuBuilder::new(app, "File")
                    .item(&new_note)
                    .item(&new_window)
                    .separator()
                    .item(&open_folder)
                    .separator()
                    .item(&save_note)
                    .build()?;

                let edit_submenu = SubmenuBuilder::new(app, "Edit")
                    .undo()
                    .redo()
                    .separator()
                    .cut()
                    .copy()
                    .paste()
                    .select_all()
                    .build()?;

                let search_submenu = SubmenuBuilder::new(app, "Search")
                    .item(&search_omni)
                    .item(&search_files)
                    .item(&search_content)
                    .item(&search_tags)
                    .separator()
                    .item(&command_palette)
                    .build()?;

                let view_submenu = SubmenuBuilder::new(app, "View")
                    .item(&toggle_sidebar)
                    .item(&toggle_vim)
                    .item(&toggle_render)
                    .separator()
                    .item(&PredefinedMenuItem::fullscreen(app, None)?)
                    .build()?;

                let window_submenu = SubmenuBuilder::new(app, "Window")
                    .minimize()
                    .item(&PredefinedMenuItem::maximize(app, None)?)
                    .build()?;

                let menu = MenuBuilder::new(app)
                    .items(&[
                        &app_submenu,
                        &file_submenu,
                        &edit_submenu,
                        &search_submenu,
                        &view_submenu,
                        &window_submenu,
                    ])
                    .build()?;

                app.set_menu(menu)?;

                app.on_menu_event(|app_handle, event| match event.id().as_ref() {
                    "new_window" => {
                        let state = app_handle.state::<AppState>();
                        let _ = spawn_window(app_handle, &state, None, None);
                    }
                    "new_note" => emit_to_focused_window(app_handle, "menu:new-note"),
                    "open_folder" => emit_to_focused_window(app_handle, "menu:open-folder"),
                    "save_note" => emit_to_focused_window(app_handle, "menu:save"),
                    "open_settings" => emit_to_focused_window(app_handle, "menu:settings"),
                    "command_palette" => emit_to_focused_window(app_handle, "menu:command-palette"),
                    "search_omni" => emit_to_focused_window(app_handle, "menu:search-omni"),
                    "search_files" => emit_to_focused_window(app_handle, "menu:search-files"),
                    "search_content" => emit_to_focused_window(app_handle, "menu:search-content"),
                    "search_tags" => emit_to_focused_window(app_handle, "menu:search-tags"),
                    "toggle_sidebar" => emit_to_focused_window(app_handle, "menu:toggle-sidebar"),
                    "toggle_vim" => emit_to_focused_window(app_handle, "menu:toggle-vim"),
                    "toggle_render" => emit_to_focused_window(app_handle, "menu:toggle-render"),
                    _ => {}
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let state = window.state::<AppState>();
                let label = window.label().to_string();
                let removed = state
                    .window_targets
                    .lock()
                    .ok()
                    .and_then(|mut map| map.remove(&label));
                if let Some(target) = removed {
                    if let Some(dir) = target.root_dir {
                        if let Ok(mut watchers) = state.watchers.lock() {
                            watchers.unwatch(std::path::Path::new(&dir));
                        }
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::fs::read_directory_tree,
            commands::fs::refresh_directory_tree,
            commands::fs::suggest_directories,
            commands::fs::unwatch_directory,
            commands::fs::read_note,
            commands::fs::write_note,
            commands::fs::create_note,
            commands::fs::create_folder,
            commands::fs::rename_path,
            commands::fs::move_paths,
            commands::fs::copy_paths,
            commands::fs::open_in_default_app,
            commands::fs::delete_note,
            commands::fs::search_notes,
            commands::fs::list_tags,
            commands::config::get_config,
            commands::config::save_global_config,
            commands::config::get_config_paths,
            commands::config::get_local_state,
            commands::config::save_local_state,
            commands::storage::get_storage_credentials_status,
            commands::storage::save_r2_credentials,
            commands::storage::clear_r2_credentials,
            commands::storage::upload_pasted_image,
            commands::storage::read_image_data_url,
            commands::storage::list_trashed_images,
            commands::storage::purge_expired_trash,
            commands::window::open_new_window,
            commands::window::get_window_launch_target,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Nib");
}
