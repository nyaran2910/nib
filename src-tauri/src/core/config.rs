use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppConfig {
    /// Default directory opened on launch when no CLI path is provided
    pub default_directory: Option<String>,
    /// "empty" (open blank tab) | "last_note" (re-open previous Markdown file)
    pub startup_behavior: String,
    pub editor: EditorConfig,
    pub appearance: AppearanceConfig,
    pub ui: UiVisibilityConfig,
    pub explorer: ExplorerConfig,
    pub properties: PropertiesConfig,
    /// Maps command IDs (e.g. "nib:save", "nib:search-omni") to key sequences
    pub keybindings: HashMap<String, String>,
    pub storage: StorageConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct EditorConfig {
    pub vim_mode: bool,
    /// "rich" (Obsidian) | "minimal" (render-markdown minimal) | "raw" (source)
    pub render_mode: String,
    /// "relative" (Neovim hybrid) | "absolute" | "off"
    pub line_number_mode: String,
    /// "centered" (readable column) | "full" (Notion full-page)
    pub editor_width: String,
    pub font_family: String,
    pub mono_font_family: String,
    pub font_size: u16,
    pub line_height: f64,
    pub tab_size: u8,
    pub yank_highlight_ms: u64,
    /// Debounced auto-save interval in ms (0 disables auto-save)
    pub auto_save_ms: u64,
    /// Show raw YAML frontmatter (--- ... ---) in the editor body vs Properties container only
    pub show_frontmatter_in_editor: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppearanceConfig {
    /// "system" | "light" | "dark"
    pub theme: String,
    pub sidebar_width: u16,
    /// Pixel delta per panel resize step (e.g. 5px)
    pub panel_resize_step: u16,
}

/// Fine-grained visibility toggles for every UI chrome element.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct UiVisibilityConfig {
    pub show_topbar: bool,
    pub show_topbar_search: bool,
    pub show_topbar_render_toggle: bool,
    pub show_topbar_vim_toggle: bool,
    pub show_topbar_command_palette: bool,
    pub show_topbar_new_window: bool,
    pub show_topbar_settings: bool,
    pub show_statusbar: bool,
    pub show_sidebar_search: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ExplorerConfig {
    /// "vim" | "emacs" | "standard"
    pub keymap_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct PropertiesConfig {
    /// "vim" (j/k/h/l + i/o/d/Esc) | "standard"
    pub keymap_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct StorageConfig {
    /// "local_folder" (relative `<note_dir>/images`) | "r2" (Cloudflare R2)
    pub provider: String,
    /// Subdirectory name inside the note's folder when provider == "local_folder"
    pub local_images_dir: String,
    /// Toggle automatic WebP compression on image paste/drop
    pub auto_convert_webp: bool,
    /// WebP quality (1-100) when auto_convert_webp is enabled
    pub webp_quality: u8,
    pub trash_retention_days: u32,
    /// Cloudflare R2 Account ID
    pub r2_account_id: Option<String>,
    pub r2_bucket: Option<String>,
    /// Optional custom S3 endpoint override
    pub r2_endpoint: Option<String>,
    /// Public CDN / r2.dev base URL for embedded Markdown links
    pub r2_public_base_url: Option<String>,
}

/// Sensitive API credentials stored strictly in device-local `~/.local/state/nib/credentials.json`
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct StorageCredentials {
    pub r2_access_key_id: Option<String>,
    pub r2_secret_access_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageCredentialsStatus {
    pub has_access_key_id: bool,
    pub access_key_id_preview: Option<String>,
    pub has_secret_access_key: bool,
}

/// Optional folder-level override stored at `<folder>/.nib/config.toml`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FolderConfigOverride {
    pub editor: Option<EditorConfigOverride>,
    pub appearance: Option<AppearanceConfigOverride>,
    pub keybindings: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EditorConfigOverride {
    pub vim_mode: Option<bool>,
    pub render_mode: Option<String>,
    pub line_number_mode: Option<String>,
    pub editor_width: Option<String>,
    pub font_size: Option<u16>,
    pub line_height: Option<f64>,
    pub tab_size: Option<u8>,
    pub yank_highlight_ms: Option<u64>,
    pub auto_save_ms: Option<u64>,
    pub show_frontmatter_in_editor: Option<bool>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AppearanceConfigOverride {
    pub theme: Option<String>,
    pub sidebar_width: Option<u16>,
}

/// Device-local state stored strictly at `~/.local/state/nib/state.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct LocalState {
    pub recent_paths: Vec<String>,
    pub sidebar_visible: bool,
    pub last_opened_file: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigPathsInfo {
    pub global_config_file: String,
    pub local_state_file: String,
    pub folder_config_file: Option<String>,
}

impl Default for EditorConfig {
    fn default() -> Self {
        Self {
            vim_mode: true,
            render_mode: "rich".to_string(),
            line_number_mode: "relative".to_string(),
            editor_width: "centered".to_string(),
            font_family:
                "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif"
                    .to_string(),
            mono_font_family: "'SF Mono', ui-monospace, Menlo, Monaco, monospace".to_string(),
            font_size: 16,
            line_height: 1.7,
            tab_size: 2,
            yank_highlight_ms: 220,
            auto_save_ms: 1200,
            show_frontmatter_in_editor: true,
        }
    }
}

impl Default for AppearanceConfig {
    fn default() -> Self {
        Self {
            theme: "system".to_string(),
            sidebar_width: 248,
            panel_resize_step: 5,
        }
    }
}

impl Default for UiVisibilityConfig {
    fn default() -> Self {
        Self {
            show_topbar: true,
            show_topbar_search: true,
            show_topbar_render_toggle: true,
            show_topbar_vim_toggle: true,
            show_topbar_command_palette: true,
            show_topbar_new_window: true,
            show_topbar_settings: true,
            show_statusbar: true,
            show_sidebar_search: true,
        }
    }
}

impl Default for ExplorerConfig {
    fn default() -> Self {
        Self {
            keymap_mode: "vim".to_string(),
        }
    }
}

impl Default for PropertiesConfig {
    fn default() -> Self {
        Self {
            keymap_mode: "vim".to_string(),
        }
    }
}

impl Default for StorageConfig {
    fn default() -> Self {
        Self {
            provider: "local_folder".to_string(),
            local_images_dir: "images".to_string(),
            auto_convert_webp: true,
            webp_quality: 82,
            trash_retention_days: 30,
            r2_account_id: None,
            r2_bucket: None,
            r2_endpoint: None,
            r2_public_base_url: None,
        }
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        let mut keybindings = HashMap::new();
        keybindings.insert("nib:save".into(), "Mod-s".into());
        keybindings.insert("nib:new-note".into(), "Mod-n".into());
        keybindings.insert("nib:new-tab".into(), "Mod-t".into());
        keybindings.insert("nib:close-tab".into(), "Mod-w".into());
        keybindings.insert("nib:next-tab".into(), "Mod-Shift-]".into());
        keybindings.insert("nib:prev-tab".into(), "Mod-Shift-[".into());
        keybindings.insert("nib:new-window".into(), "Mod-Shift-n".into());
        keybindings.insert("nib:open-folder".into(), "Mod-o".into());
        keybindings.insert("nib:toggle-left-panel".into(), "Mod-Shift-s".into());
        keybindings.insert("nib:toggle-right-panel".into(), "Mod-Shift-.".into());
        keybindings.insert("nib:toggle-bottom-panel".into(), "Mod-Shift-b".into());
        keybindings.insert("nib:resize-panel-left".into(), "Ctrl-Alt-h".into());
        keybindings.insert("nib:resize-panel-right".into(), "Ctrl-Alt-l".into());
        keybindings.insert("nib:resize-panel-up".into(), "Ctrl-Alt-k".into());
        keybindings.insert("nib:resize-panel-down".into(), "Ctrl-Alt-j".into());
        keybindings.insert("nib:toggle-vim".into(), "Mod-Shift-v".into());
        keybindings.insert("nib:cycle-render-mode".into(), "Mod-Shift-m".into());
        keybindings.insert("nib:open-settings".into(), "Mod-,".into());
        keybindings.insert("nib:command-palette".into(), "Mod-Shift-p".into());
        keybindings.insert("nib:search-omni".into(), "Mod-k".into());
        keybindings.insert("nib:search-files".into(), "Mod-Shift-o".into());
        keybindings.insert("nib:search-content".into(), "Mod-Shift-f".into());
        keybindings.insert("nib:search-tags".into(), "Mod-Shift-t".into());

        Self {
            default_directory: None,
            startup_behavior: "empty".to_string(),
            editor: EditorConfig::default(),
            appearance: AppearanceConfig::default(),
            ui: UiVisibilityConfig::default(),
            explorer: ExplorerConfig::default(),
            properties: PropertiesConfig::default(),
            keybindings,
            storage: StorageConfig::default(),
        }
    }
}

impl Default for LocalState {
    fn default() -> Self {
        Self {
            recent_paths: Vec::new(),
            sidebar_visible: true,
            last_opened_file: None,
        }
    }
}

pub fn expand_tilde(raw: &str) -> PathBuf {
    let trimmed = raw.trim();
    if trimmed == "~" {
        return dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    }
    if let Some(rest) = trimmed.strip_prefix("~/") {
        return dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(rest);
    }
    PathBuf::from(trimmed)
}

pub fn global_config_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".config")
        .join("nib")
}

pub fn global_config_file() -> PathBuf {
    global_config_dir().join("config.toml")
}

pub fn local_state_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".local")
        .join("state")
        .join("nib")
}

pub fn local_state_file() -> PathBuf {
    local_state_dir().join("state.json")
}

pub fn credentials_file() -> PathBuf {
    local_state_dir().join("credentials.json")
}

pub fn folder_config_file(folder: &Path) -> PathBuf {
    folder.join(".nib").join("config.toml")
}

pub fn load_effective_config(folder: Option<&Path>) -> Result<AppConfig, String> {
    let global_path = global_config_file();
    let mut config = if global_path.exists() {
        let raw = fs::read_to_string(&global_path)
            .map_err(|e| format!("Failed to read global config: {e}"))?;
        toml::from_str::<AppConfig>(&raw)
            .map_err(|e| format!("Failed to parse global config TOML: {e}"))?
    } else {
        let defaults = AppConfig::default();
        let _ = save_global_config(&defaults);
        defaults
    };

    // Migrate old "local" provider string to "local_folder"
    if config.storage.provider == "local" {
        config.storage.provider = "local_folder".to_string();
    }

    let defaults = AppConfig::default();
    for (cmd_id, default_key) in defaults.keybindings {
        config.keybindings.entry(cmd_id).or_insert(default_key);
    }

    if let Some(dir) = folder {
        let override_path = folder_config_file(dir);
        if override_path.exists() {
            let raw = fs::read_to_string(&override_path)
                .map_err(|e| format!("Failed to read folder config: {e}"))?;
            let ov: FolderConfigOverride = toml::from_str(&raw)
                .map_err(|e| format!("Failed to parse folder config TOML: {e}"))?;
            apply_override(&mut config, ov);
        }
    }

    Ok(config)
}

pub fn save_global_config(config: &AppConfig) -> Result<(), String> {
    let dir = global_config_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create config dir: {e}"))?;
    let serialized = toml::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config TOML: {e}"))?;
    fs::write(global_config_file(), serialized)
        .map_err(|e| format!("Failed to write global config: {e}"))
}

pub fn load_local_state() -> LocalState {
    let path = local_state_file();
    if let Ok(raw) = fs::read_to_string(&path) {
        if let Ok(state) = serde_json::from_str::<LocalState>(&raw) {
            return state;
        }
    }
    LocalState::default()
}

pub fn save_local_state(state: &LocalState) -> Result<(), String> {
    let dir = local_state_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create local state dir: {e}"))?;
    let serialized = serde_json::to_string_pretty(state)
        .map_err(|e| format!("Failed to serialize local state: {e}"))?;
    fs::write(local_state_file(), serialized)
        .map_err(|e| format!("Failed to write local state: {e}"))
}

pub fn load_storage_credentials() -> StorageCredentials {
    let path = credentials_file();
    if let Ok(raw) = fs::read_to_string(&path) {
        if let Ok(creds) = serde_json::from_str::<StorageCredentials>(&raw) {
            return creds;
        }
    }
    StorageCredentials::default()
}

pub fn save_storage_credentials(creds: &StorageCredentials) -> Result<(), String> {
    let dir = local_state_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create local state dir: {e}"))?;
    let path = credentials_file();
    let serialized = serde_json::to_string_pretty(creds)
        .map_err(|e| format!("Failed to serialize credentials: {e}"))?;
    fs::write(&path, serialized).map_err(|e| format!("Failed to write credentials: {e}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }

    Ok(())
}

pub fn credentials_status(creds: &StorageCredentials) -> StorageCredentialsStatus {
    let preview = creds.r2_access_key_id.as_deref().map(|k| {
        if k.len() <= 8 {
            "••••".to_string()
        } else {
            format!("{}••••{}", &k[..4], &k[k.len() - 4..])
        }
    });
    StorageCredentialsStatus {
        has_access_key_id: creds
            .r2_access_key_id
            .as_deref()
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false),
        access_key_id_preview: preview,
        has_secret_access_key: creds
            .r2_secret_access_key
            .as_deref()
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false),
    }
}

fn apply_override(base: &mut AppConfig, ov: FolderConfigOverride) {
    if let Some(ed) = ov.editor {
        if let Some(v) = ed.vim_mode {
            base.editor.vim_mode = v;
        }
        if let Some(v) = ed.render_mode {
            base.editor.render_mode = v;
        }
        if let Some(v) = ed.line_number_mode {
            base.editor.line_number_mode = v;
        }
        if let Some(v) = ed.editor_width {
            base.editor.editor_width = v;
        }
        if let Some(v) = ed.font_size {
            base.editor.font_size = v;
        }
        if let Some(v) = ed.line_height {
            base.editor.line_height = v;
        }
        if let Some(v) = ed.tab_size {
            base.editor.tab_size = v;
        }
        if let Some(v) = ed.yank_highlight_ms {
            base.editor.yank_highlight_ms = v;
        }
        if let Some(v) = ed.auto_save_ms {
            base.editor.auto_save_ms = v;
        }
        if let Some(v) = ed.show_frontmatter_in_editor {
            base.editor.show_frontmatter_in_editor = v;
        }
    }
    if let Some(ap) = ov.appearance {
        if let Some(v) = ap.theme {
            base.appearance.theme = v;
        }
        if let Some(v) = ap.sidebar_width {
            base.appearance.sidebar_width = v;
        }
    }
    if let Some(kb) = ov.keybindings {
        for (k, v) in kb {
            base.keybindings.insert(k, v);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_toml_roundtrip_and_override() {
        let mut cfg = AppConfig::default();
        assert_eq!(cfg.storage.provider, "local_folder");
        assert_eq!(cfg.storage.local_images_dir, "images");
        assert!(cfg.storage.auto_convert_webp);
        assert_eq!(cfg.keybindings.get("nib:search-omni").map(String::as_str), Some("Mod-k"));
        assert_eq!(cfg.keybindings.get("nib:command-palette").map(String::as_str), Some("Mod-Shift-p"));
        assert_eq!(cfg.keybindings.get("nib:toggle-left-panel").map(String::as_str), Some("Mod-Shift-s"));
        assert_eq!(cfg.keybindings.get("nib:toggle-right-panel").map(String::as_str), Some("Mod-Shift-."));
        assert_eq!(cfg.keybindings.get("nib:toggle-bottom-panel").map(String::as_str), Some("Mod-Shift-b"));
        assert_eq!(cfg.editor.render_mode, "rich");
        assert_eq!(cfg.editor.line_number_mode, "relative");
        assert_eq!(cfg.editor.editor_width, "centered");

        let serialized = toml::to_string_pretty(&cfg).expect("serialize toml");
        let parsed: AppConfig = toml::from_str(&serialized).expect("parse toml");
        assert_eq!(parsed.explorer.keymap_mode, "vim");
        assert!(parsed.ui.show_statusbar);

        let ov = FolderConfigOverride {
            editor: Some(EditorConfigOverride {
                vim_mode: Some(false),
                font_size: Some(18),
                ..Default::default()
            }),
            ..Default::default()
        };
        apply_override(&mut cfg, ov);
        assert!(!cfg.editor.vim_mode);
        assert_eq!(cfg.editor.font_size, 18);
    }

    #[test]
    fn credentials_status_masks_access_key() {
        let creds = StorageCredentials {
            r2_access_key_id: Some("abcd12345678wxyz".into()),
            r2_secret_access_key: Some("super-secret".into()),
        };
        let status = credentials_status(&creds);
        assert!(status.has_access_key_id);
        assert!(status.has_secret_access_key);
        assert_eq!(status.access_key_id_preview.as_deref(), Some("abcd••••wxyz"));
    }
}
