use crate::core::config::expand_tilde;
use crate::core::search::{SearchHit, SearchMode, TagCount};
use crate::state::AppState;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};

#[derive(Debug, Clone, Serialize)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Vec<FileNode>,
}

const IGNORED_DIRS: &[&str] = &[".git", ".nib", "node_modules", "target", ".DS_Store"];

fn is_markdown_file(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .map(|s| s.to_lowercase())
            .as_deref(),
        Some("md" | "markdown" | "mdx" | "txt")
    )
}

fn build_tree(dir: &Path, depth: usize) -> Result<Vec<FileNode>, String> {
    if depth > 12 {
        return Ok(Vec::new());
    }
    let mut dirs = Vec::new();
    let mut files = Vec::new();

    let entries = fs::read_dir(dir).map_err(|e| format!("Failed to read directory: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || IGNORED_DIRS.contains(&name.as_str()) {
            continue;
        }
        if path.is_dir() {
            let children = build_tree(&path, depth + 1).unwrap_or_default();
            dirs.push(FileNode {
                name,
                path: path.to_string_lossy().to_string(),
                is_dir: true,
                children,
            });
        } else if is_markdown_file(&path) {
            files.push(FileNode {
                name,
                path: path.to_string_lossy().to_string(),
                is_dir: false,
                children: Vec::new(),
            });
        }
    }

    dirs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    dirs.extend(files);
    Ok(dirs)
}

#[tauri::command]
pub async fn read_directory_tree(
    app: AppHandle,
    state: State<'_, AppState>,
    root_path: String,
) -> Result<Vec<FileNode>, String> {
    let root = expand_tilde(&root_path);
    if !root.exists() || !root.is_dir() {
        return Err(format!("Directory does not exist: {}", root.display()));
    }

    // Register with centralized ref-counted watcher (called once when opening a folder)
    if let Ok(mut watchers) = state.watchers.lock() {
        let _ = watchers.watch(&app, &root);
    }

    let root_for_tree = root.clone();
    let tree = tokio::task::spawn_blocking(move || build_tree(&root_for_tree, 0))
        .await
        .map_err(|e| format!("Failed to scan directory: {e}"))??;

    // Index all Markdown files for instant 4-mode fzf fuzzy search
    if let Ok(mut index) = state.search_index.write() {
        index.index_directory(&root);
    }

    Ok(tree)
}

/// Rebuilds only the directory tree without incrementing watcher ref-count or re-indexing all files.
#[tauri::command]
pub async fn refresh_directory_tree(root_path: String) -> Result<Vec<FileNode>, String> {
    let root = expand_tilde(&root_path);
    if !root.exists() || !root.is_dir() {
        return Err(format!("Directory does not exist: {}", root.display()));
    }
    tokio::task::spawn_blocking(move || build_tree(&root, 0))
        .await
        .map_err(|e| format!("Failed to refresh directory: {e}"))?
}

/// Suggests existing filesystem directories matching a user-typed prefix (supports `~/`).
#[tauri::command]
pub fn suggest_directories(prefix: String) -> Vec<String> {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
    let home_str = home.to_string_lossy().to_string();
    let trimmed = prefix.trim();
    let use_tilde = trimmed.is_empty() || trimmed.starts_with('~');

    let expanded = if trimmed.is_empty() {
        home.clone()
    } else {
        expand_tilde(trimmed)
    };

    let (scan_dir, filter) = if expanded.is_dir() && (trimmed.is_empty() || trimmed.ends_with('/')) {
        (expanded, String::new())
    } else {
        let parent = expanded
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| home.clone());
        let name = expanded
            .file_name()
            .map(|n| n.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        (parent, name)
    };

    let Ok(entries) = fs::read_dir(&scan_dir) else {
        return Vec::new();
    };

    let mut matches: Vec<String> = entries
        .flatten()
        .filter_map(|entry| {
            let p = entry.path();
            if !p.is_dir() {
                return None;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') && !filter.starts_with('.') {
                return None;
            }
            let lower = name.to_lowercase();
            if !filter.is_empty() && !lower.contains(&filter) {
                return None;
            }
            let full = p.to_string_lossy().to_string();
            if use_tilde && full.starts_with(&home_str) {
                Some(format!("~{}/", &full[home_str.len()..]))
            } else {
                Some(format!("{full}/"))
            }
        })
        .collect();

    matches.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    matches.truncate(12);
    matches
}

#[tauri::command]
pub fn unwatch_directory(state: State<'_, AppState>, root_path: String) {
    if let Ok(mut watchers) = state.watchers.lock() {
        watchers.unwatch(Path::new(&root_path));
    }
}

#[tauri::command]
pub fn read_note(state: State<'_, AppState>, path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    let content = fs::read_to_string(&p).map_err(|e| format!("Failed to read file: {e}"))?;

    if let Ok(mut index) = state.search_index.write() {
        index.upsert(&p, &content);
    }
    if let Ok(mut refs) = state.image_refs.lock() {
        let retention = state
            .config
            .read()
            .map(|c| c.storage.trash_retention_days)
            .unwrap_or(30);
        refs.update_document(&p, &content, retention);
    }

    Ok(content)
}

#[tauri::command]
pub fn write_note(
    state: State<'_, AppState>,
    path: String,
    content: String,
) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create parent dir: {e}"))?;
    }
    fs::write(&p, &content).map_err(|e| format!("Failed to write file: {e}"))?;

    if let Ok(mut index) = state.search_index.write() {
        index.upsert(&p, &content);
    }
    if let Ok(mut refs) = state.image_refs.lock() {
        let retention = state
            .config
            .read()
            .map(|c| c.storage.trash_retention_days)
            .unwrap_or(30);
        let _trashed = refs.update_document(&p, &content, retention);
    }

    Ok(())
}

#[tauri::command]
pub fn create_note(
    state: State<'_, AppState>,
    dir_path: String,
    file_name: String,
) -> Result<String, String> {
    let clean_name = if file_name.ends_with(".md") || file_name.ends_with(".markdown") {
        file_name
    } else {
        format!("{file_name}.md")
    };
    let target = PathBuf::from(&dir_path).join(&clean_name);
    if target.exists() {
        return Err(format!("File already exists: {}", target.display()));
    }
    fs::write(&target, "").map_err(|e| format!("Failed to create note: {e}"))?;
    if let Ok(mut index) = state.search_index.write() {
        index.upsert(&target, "");
    }
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub fn create_folder(parent_dir: String, folder_name: String) -> Result<String, String> {
    let clean = folder_name.trim().trim_matches('/');
    if clean.is_empty() {
        return Err("Folder name cannot be empty".into());
    }
    let target = PathBuf::from(&parent_dir).join(clean);
    fs::create_dir_all(&target).map_err(|e| format!("Failed to create folder: {e}"))?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub fn rename_path(
    state: State<'_, AppState>,
    old_path: String,
    new_name: String,
) -> Result<String, String> {
    let old = PathBuf::from(&old_path);
    let clean = new_name.trim().trim_matches('/');
    if clean.is_empty() {
        return Err("New name cannot be empty".into());
    }
    let parent = old
        .parent()
        .ok_or_else(|| "Cannot determine parent directory".to_string())?;
    let mut final_name = clean.to_string();
    if old.is_file()
        && !final_name.ends_with(".md")
        && !final_name.ends_with(".markdown")
        && !final_name.ends_with(".txt")
    {
        final_name.push_str(".md");
    }
    let new_path = parent.join(&final_name);
    if new_path.exists() {
        return Err(format!("Target already exists: {}", new_path.display()));
    }
    fs::rename(&old, &new_path).map_err(|e| format!("Failed to rename: {e}"))?;

    if let Ok(mut index) = state.search_index.write() {
        index.remove(&old);
        if new_path.is_file() {
            if let Ok(content) = fs::read_to_string(&new_path) {
                index.upsert(&new_path, &content);
            }
        }
    }

    Ok(new_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn delete_note(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if p.is_dir() {
        fs::remove_dir_all(&p).map_err(|e| format!("Failed to delete folder: {e}"))?;
    } else if p.exists() {
        fs::remove_file(&p).map_err(|e| format!("Failed to delete note: {e}"))?;
    }
    if let Ok(mut index) = state.search_index.write() {
        index.remove(&p);
    }
    Ok(())
}

#[tauri::command]
pub fn search_notes(
    state: State<'_, AppState>,
    query: String,
    mode: Option<SearchMode>,
    tag_filter: Option<String>,
    limit: Option<usize>,
) -> Vec<SearchHit> {
    state
        .search_index
        .read()
        .map(|idx| {
            idx.search(
                &query,
                mode.unwrap_or(SearchMode::Omni),
                tag_filter.as_deref(),
                limit.unwrap_or(30),
            )
        })
        .unwrap_or_default()
}

#[tauri::command]
pub fn list_tags(state: State<'_, AppState>, query: Option<String>) -> Vec<TagCount> {
    state
        .search_index
        .read()
        .map(|idx| idx.list_tags(query.as_deref()))
        .unwrap_or_default()
}

/// Opens a file or folder with the OS default application (macOS `open`).
#[tauri::command]
pub fn open_in_default_app(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open with default app: {e}"))?;
        return Ok(());
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        Ok(())
    }
}

/// Moves one or more files/folders into `target_dir` (Snacks.nvim Explorer `m` with selection).
#[tauri::command]
pub fn move_paths(
    state: State<'_, AppState>,
    sources: Vec<String>,
    target_dir: String,
) -> Result<Vec<String>, String> {
    let dest_dir = PathBuf::from(&target_dir);
    if !dest_dir.is_dir() {
        return Err(format!("Target is not a directory: {target_dir}"));
    }
    let mut moved = Vec::new();
    for src_str in sources {
        let src = PathBuf::from(&src_str);
        let Some(name) = src.file_name() else {
            continue;
        };
        let dest = dest_dir.join(name);
        if src == dest || dest.exists() {
            continue;
        }
        fs::rename(&src, &dest).map_err(|e| format!("Failed to move {}: {e}", src.display()))?;
        if let Ok(mut idx) = state.search_index.write() {
            idx.remove(&src);
            if dest.is_file() {
                if let Ok(content) = fs::read_to_string(&dest) {
                    idx.upsert(&dest, &content);
                }
            }
        }
        moved.push(dest.to_string_lossy().to_string());
    }
    Ok(moved)
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        if ty.is_dir() {
            copy_dir_recursive(&entry.path(), &dst.join(entry.file_name()))?;
        } else {
            fs::copy(entry.path(), dst.join(entry.file_name()))?;
        }
    }
    Ok(())
}

/// Copies one or more files/folders into `target_dir` (Snacks.nvim Explorer `c`).
#[tauri::command]
pub fn copy_paths(
    state: State<'_, AppState>,
    sources: Vec<String>,
    target_dir: String,
) -> Result<Vec<String>, String> {
    let dest_dir = PathBuf::from(&target_dir);
    if !dest_dir.is_dir() {
        return Err(format!("Target is not a directory: {target_dir}"));
    }
    let mut copied = Vec::new();
    for src_str in sources {
        let src = PathBuf::from(&src_str);
        let Some(stem) = src.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let ext = src.extension().and_then(|s| s.to_str());
        let mut dest = dest_dir.join(src.file_name().unwrap_or_default());
        let mut counter = 1;
        while dest.exists() {
            let candidate = match ext {
                Some(e) => format!("{stem}-copy-{counter}.{e}"),
                None => format!("{stem}-copy-{counter}"),
            };
            dest = dest_dir.join(candidate);
            counter += 1;
        }
        if src.is_dir() {
            copy_dir_recursive(&src, &dest)
                .map_err(|e| format!("Failed to copy dir {}: {e}", src.display()))?;
        } else {
            fs::copy(&src, &dest)
                .map_err(|e| format!("Failed to copy {}: {e}", src.display()))?;
            if let Ok(mut idx) = state.search_index.write() {
                if let Ok(content) = fs::read_to_string(&dest) {
                    idx.upsert(&dest, &content);
                }
            }
        }
        copied.push(dest.to_string_lossy().to_string());
    }
    Ok(copied)
}
