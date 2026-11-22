use crate::core::config::{
    credentials_status, load_storage_credentials, save_storage_credentials, StorageCredentials,
    StorageCredentialsStatus,
};
use crate::providers::storage::{
    LocalCacheStorageProvider, R2StorageProvider, StorageProvider, UploadedAsset,
};
use crate::state::AppState;
use base64::Engine;
use tauri::State;

#[tauri::command]
pub fn get_storage_credentials_status() -> StorageCredentialsStatus {
    let creds = load_storage_credentials();
    credentials_status(&creds)
}

#[tauri::command]
pub fn save_r2_credentials(
    access_key_id: Option<String>,
    secret_access_key: Option<String>,
) -> Result<StorageCredentialsStatus, String> {
    let mut current = load_storage_credentials();
    if let Some(ak) = access_key_id {
        if !ak.trim().is_empty() {
            current.r2_access_key_id = Some(ak.trim().to_string());
        }
    }
    if let Some(sk) = secret_access_key {
        if !sk.trim().is_empty() {
            current.r2_secret_access_key = Some(sk.trim().to_string());
        }
    }
    save_storage_credentials(&current)?;
    Ok(credentials_status(&current))
}

#[tauri::command]
pub fn clear_r2_credentials() -> Result<StorageCredentialsStatus, String> {
    let empty = StorageCredentials::default();
    save_storage_credentials(&empty)?;
    Ok(credentials_status(&empty))
}

/// Uploads a pasted/dropped image.
/// - When provider == "r2": uploads to Cloudflare R2 (SigV4).
/// - When provider == "local_folder" (default): saves directly into `<note_dir>/<local_images_dir>/`
///   and returns a portable relative link (`./images/<filename>`) so the folder stays 100% Git-friendly.
#[tauri::command]
pub async fn upload_pasted_image(
    state: State<'_, AppState>,
    filename_hint: String,
    mime_type: String,
    data_base64: String,
    active_file_path: Option<String>,
    root_dir: Option<String>,
) -> Result<UploadedAsset, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64.trim())
        .map_err(|e| format!("Invalid base64 image payload: {e}"))?;

    let storage_cfg = state
        .config
        .read()
        .map(|c| c.storage.clone())
        .unwrap_or_default();

    if storage_cfg.provider == "r2" {
        let creds = load_storage_credentials();
        let r2 = R2StorageProvider::from_config(&storage_cfg, &creds)
            .map_err(|e| e.to_string())?;
        return r2
            .upload_asset(&filename_hint, &mime_type, bytes)
            .await
            .map_err(|e| e.to_string());
    }

    // Save inside the opened Markdown directory (Git-friendly, self-contained)
    let base_dir = active_file_path
        .as_deref()
        .and_then(|fp| std::path::Path::new(fp).parent().map(|p| p.to_path_buf()))
        .or_else(|| root_dir.as_deref().map(std::path::PathBuf::from));

    if let Some(note_dir) = base_dir {
        let images_subdir = storage_cfg
            .local_images_dir
            .trim()
            .trim_matches('/');
        let images_subdir = if images_subdir.is_empty() {
            "images"
        } else {
            images_subdir
        };
        let target_dir = note_dir.join(images_subdir);
        std::fs::create_dir_all(&target_dir)
            .map_err(|e| format!("Failed to create images folder: {e}"))?;

        let ext = match mime_type.to_lowercase().as_str() {
            "image/webp" => "webp",
            "image/png" => "png",
            "image/jpeg" | "image/jpg" => "jpg",
            "image/gif" => "gif",
            "image/svg+xml" => "svg",
            "image/avif" => "avif",
            _ => "png",
        };
        let safe_stem: String = filename_hint
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
            .take(32)
            .collect();
        let stem = if safe_stem.is_empty() {
            "image"
        } else {
            &safe_stem
        };
        let short_id = &uuid::Uuid::new_v4().simple().to_string()[..8];
        let file_name = format!("{stem}-{short_id}.{ext}");
        let full_path = target_dir.join(&file_name);
        std::fs::write(&full_path, &bytes)
            .map_err(|e| format!("Failed to save image to folder: {e}"))?;

        let rel_url = format!("./{images_subdir}/{file_name}");
        return Ok(UploadedAsset {
            key: full_path.to_string_lossy().to_string(),
            url: rel_url,
            mime_type,
            bytes: bytes.len(),
            synced: false,
        });
    }

    let local = LocalCacheStorageProvider;
    local
        .upload_asset(&filename_hint, &mime_type, bytes)
        .await
        .map_err(|e| e.to_string())
}

/// Fallback image loader returning a data URL for local paths if WKWebView asset:// fails.
#[tauri::command]
pub fn read_image_data_url(path: String) -> Result<String, String> {
    let p = std::path::PathBuf::from(path.trim_start_matches("file://"));
    let bytes = std::fs::read(&p).map_err(|e| format!("Failed to read image: {e}"))?;
    let mime = match p
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase())
        .as_deref()
    {
        Some("webp") => "image/webp",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        Some("avif") => "image/avif",
        _ => "application/octet-stream",
    };
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{mime};base64,{encoded}"))
}

#[tauri::command]
pub fn list_trashed_images(state: State<'_, AppState>) -> Vec<crate::core::images::TrashEntry> {
    state
        .image_refs
        .lock()
        .map(|refs| refs.trash_entries().to_vec())
        .unwrap_or_default()
}

#[tauri::command]
pub fn purge_expired_trash(state: State<'_, AppState>) -> usize {
    state
        .image_refs
        .lock()
        .map(|mut refs| refs.purge_expired().len())
        .unwrap_or(0)
}
