import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { confirm, open } from "@tauri-apps/plugin-dialog";

export type SearchMode = "omni" | "files" | "content" | "tags";

export interface EditorConfig {
  vim_mode: boolean;
  render_markdown: boolean;
  font_family: string;
  mono_font_family: string;
  font_size: number;
  line_height: number;
  tab_size: number;
  yank_highlight_ms: number;
  line_numbers: boolean;
  auto_save_ms: number;
  show_frontmatter_in_editor: boolean;
}

export interface AppearanceConfig {
  theme: "system" | "light" | "dark" | string;
  sidebar_width: number;
}

export interface UiVisibilityConfig {
  show_topbar: boolean;
  show_topbar_search: boolean;
  show_topbar_render_toggle: boolean;
  show_topbar_vim_toggle: boolean;
  show_topbar_command_palette: boolean;
  show_topbar_new_window: boolean;
  show_topbar_settings: boolean;
  show_statusbar: boolean;
  show_sidebar_search: boolean;
}

export interface ExplorerConfig {
  keymap_mode: "vim" | "emacs" | string;
}

export interface StorageConfig {
  provider: "local_folder" | "r2" | string;
  local_images_dir: string;
  auto_convert_webp: boolean;
  webp_quality: number;
  trash_retention_days: number;
  r2_account_id?: string | null;
  r2_bucket?: string | null;
  r2_endpoint?: string | null;
  r2_public_base_url?: string | null;
}

export interface StorageCredentialsStatus {
  has_access_key_id: boolean;
  access_key_id_preview?: string | null;
  has_secret_access_key: boolean;
}

export interface UploadedAsset {
  key: string;
  url: string;
  mime_type: string;
  bytes: number;
  synced: boolean;
}

export interface AppConfig {
  default_directory?: string | null;
  startup_behavior: "empty" | "last_note" | string;
  editor: EditorConfig;
  appearance: AppearanceConfig;
  ui: UiVisibilityConfig;
  explorer: ExplorerConfig;
  keybindings: Record<string, string>;
  storage: StorageConfig;
}

export interface LocalState {
  recent_paths: string[];
  sidebar_visible: boolean;
  last_opened_file?: string | null;
}

export interface ConfigPathsInfo {
  global_config_file: string;
  local_state_file: string;
  folder_config_file?: string | null;
}

export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children: FileNode[];
}

export interface WindowLaunchTarget {
  root_dir?: string | null;
  file_path?: string | null;
}

export interface SearchHit {
  path: string;
  relative_path: string;
  title: string;
  snippet: string;
  line?: number | null;
  tags: string[];
  score: number;
  matched_by: string[];
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface TrashEntry {
  image_key: string;
  deleted_at: string;
  purge_after: string;
}

export const DEFAULT_CONFIG: AppConfig = {
  default_directory: null,
  startup_behavior: "empty",
  editor: {
    vim_mode: true,
    render_markdown: true,
    font_family: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif",
    mono_font_family: "'SF Mono', ui-monospace, Menlo, Monaco, monospace",
    font_size: 16,
    line_height: 1.7,
    tab_size: 2,
    yank_highlight_ms: 220,
    line_numbers: false,
    auto_save_ms: 1200,
    show_frontmatter_in_editor: true,
  },
  appearance: {
    theme: "system",
    sidebar_width: 248,
  },
  ui: {
    show_topbar: true,
    show_topbar_search: true,
    show_topbar_render_toggle: true,
    show_topbar_vim_toggle: true,
    show_topbar_command_palette: true,
    show_topbar_new_window: true,
    show_topbar_settings: true,
    show_statusbar: true,
    show_sidebar_search: true,
  },
  explorer: {
    keymap_mode: "vim",
  },
  keybindings: {
    "nib:save": "Mod-s",
    "nib:new-note": "Mod-n",
    "nib:new-tab": "Mod-t",
    "nib:close-tab": "Mod-w",
    "nib:next-tab": "Mod-Shift-]",
    "nib:prev-tab": "Mod-Shift-[",
    "nib:new-window": "Mod-Shift-n",
    "nib:open-folder": "Mod-o",
    "nib:toggle-sidebar": "Mod-Shift-s",
    "nib:focus-explorer": "Mod-Ctrl-1",
    "nib:focus-properties": "Mod-Ctrl-2",
    "nib:toggle-vim": "Mod-Shift-v",
    "nib:toggle-render-markdown": "Mod-Shift-m",
    "nib:open-settings": "Mod-,",
    "nib:command-palette": "Mod-Shift-p",
    "nib:search-omni": "Mod-k",
    "nib:search-files": "Mod-Shift-o",
    "nib:search-content": "Mod-Shift-f",
    "nib:search-tags": "Mod-Shift-t",
  },
  storage: {
    provider: "local_folder",
    local_images_dir: "images",
    auto_convert_webp: true,
    webp_quality: 82,
    trash_retention_days: 30,
    r2_account_id: null,
    r2_bucket: null,
    r2_endpoint: null,
    r2_public_base_url: null,
  },
};

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function resolveImageSrc(
  rawSrc: string,
  activeFilePath: string | null,
  rootDir?: string | null,
): string {
  const trimmed = rawSrc.trim();
  if (/^(https?:|data:|blob:|asset:)/i.test(trimmed)) {
    return trimmed;
  }
  if (!isTauriRuntime()) {
    return trimmed;
  }
  if (trimmed.startsWith("/")) {
    return convertFileSrc(trimmed);
  }
  const cleanRel = trimmed.replace(/^\.\//, "");
  const baseDir = activeFilePath
    ? activeFilePath.slice(0, activeFilePath.lastIndexOf("/"))
    : rootDir ?? null;
  if (baseDir) {
    return convertFileSrc(`${baseDir}/${cleanRel}`);
  }
  return trimmed;
}

export async function getWindowLaunchTarget(): Promise<WindowLaunchTarget> {
  if (!isTauriRuntime()) return {};
  return invoke<WindowLaunchTarget>("get_window_launch_target");
}

export async function getConfig(folderPath?: string | null): Promise<AppConfig> {
  if (!isTauriRuntime()) return structuredClone(DEFAULT_CONFIG);
  return invoke<AppConfig>("get_config", { folderPath: folderPath ?? null });
}

export async function saveGlobalConfig(config: AppConfig): Promise<void> {
  if (!isTauriRuntime()) return;
  return invoke("save_global_config", { config });
}

export async function getConfigPaths(folderPath?: string | null): Promise<ConfigPathsInfo> {
  if (!isTauriRuntime()) {
    return {
      global_config_file: "~/.config/nib/config.toml",
      local_state_file: "~/.local/state/nib/state.json",
      folder_config_file: folderPath ? `${folderPath}/.nib/config.toml` : null,
    };
  }
  return invoke<ConfigPathsInfo>("get_config_paths", { folderPath: folderPath ?? null });
}

export async function getLocalState(): Promise<LocalState> {
  if (!isTauriRuntime()) {
    return { recent_paths: [], sidebar_visible: true, last_opened_file: null };
  }
  return invoke<LocalState>("get_local_state");
}

export async function saveLocalState(localState: LocalState): Promise<void> {
  if (!isTauriRuntime()) return;
  return invoke("save_local_state", { localState });
}

export async function readDirectoryTree(rootPath: string): Promise<FileNode[]> {
  if (!isTauriRuntime()) return [];
  return invoke<FileNode[]>("read_directory_tree", { rootPath });
}

export async function refreshDirectoryTree(rootPath: string): Promise<FileNode[]> {
  if (!isTauriRuntime()) return [];
  return invoke<FileNode[]>("refresh_directory_tree", { rootPath });
}

export async function suggestDirectories(prefix: string): Promise<string[]> {
  if (!isTauriRuntime()) return [];
  return invoke<string[]>("suggest_directories", { prefix });
}

export async function unwatchDirectory(rootPath: string): Promise<void> {
  if (!isTauriRuntime()) return;
  return invoke("unwatch_directory", { rootPath });
}

export async function readNote(path: string): Promise<string> {
  if (!isTauriRuntime()) return "";
  return invoke<string>("read_note", { path });
}

export async function writeNote(path: string, content: string): Promise<void> {
  if (!isTauriRuntime()) return;
  return invoke("write_note", { path, content });
}

export async function createNote(dirPath: string, fileName: string): Promise<string> {
  if (!isTauriRuntime()) return `${dirPath}/${fileName}`;
  return invoke<string>("create_note", { dirPath, fileName });
}

export async function createFolder(parentDir: string, folderName: string): Promise<string> {
  if (!isTauriRuntime()) return `${parentDir}/${folderName}`;
  return invoke<string>("create_folder", { parentDir, folderName });
}

export async function renamePath(oldPath: string, newName: string): Promise<string> {
  if (!isTauriRuntime()) return oldPath;
  return invoke<string>("rename_path", { oldPath, newName });
}

export async function movePaths(sources: string[], targetDir: string): Promise<string[]> {
  if (!isTauriRuntime()) return [];
  return invoke<string[]>("move_paths", { sources, targetDir });
}

export async function copyPaths(sources: string[], targetDir: string): Promise<string[]> {
  if (!isTauriRuntime()) return [];
  return invoke<string[]>("copy_paths", { sources, targetDir });
}

export async function openInDefaultApp(path: string): Promise<void> {
  if (!isTauriRuntime()) return;
  return invoke("open_in_default_app", { path });
}

export async function deleteNote(path: string): Promise<void> {
  if (!isTauriRuntime()) return;
  return invoke("delete_note", { path });
}

export async function listTrashedImages(): Promise<TrashEntry[]> {
  if (!isTauriRuntime()) return [];
  return invoke<TrashEntry[]>("list_trashed_images");
}

export async function purgeExpiredTrash(): Promise<number> {
  if (!isTauriRuntime()) return 0;
  return invoke<number>("purge_expired_trash");
}

export async function searchNotes(
  query: string,
  mode: SearchMode,
  tagFilter?: string | null,
  limit = 30,
): Promise<SearchHit[]> {
  if (!isTauriRuntime()) {
    return [];
  }
  return invoke<SearchHit[]>("search_notes", {
    query,
    mode,
    tagFilter: tagFilter ?? null,
    limit,
  });
}

export async function listTags(query?: string | null): Promise<TagCount[]> {
  if (!isTauriRuntime()) return [];
  return invoke<TagCount[]>("list_tags", { query: query ?? null });
}

export async function getStorageCredentialsStatus(): Promise<StorageCredentialsStatus> {
  if (!isTauriRuntime()) {
    return { has_access_key_id: false, access_key_id_preview: null, has_secret_access_key: false };
  }
  return invoke<StorageCredentialsStatus>("get_storage_credentials_status");
}

export async function saveR2Credentials(
  accessKeyId?: string | null,
  secretAccessKey?: string | null,
): Promise<StorageCredentialsStatus> {
  if (!isTauriRuntime()) {
    return {
      has_access_key_id: Boolean(accessKeyId),
      access_key_id_preview: accessKeyId ? `${accessKeyId.slice(0, 4)}••••` : null,
      has_secret_access_key: Boolean(secretAccessKey),
    };
  }
  return invoke<StorageCredentialsStatus>("save_r2_credentials", {
    accessKeyId: accessKeyId ?? null,
    secretAccessKey: secretAccessKey ?? null,
  });
}

export async function clearR2Credentials(): Promise<StorageCredentialsStatus> {
  if (!isTauriRuntime()) {
    return { has_access_key_id: false, access_key_id_preview: null, has_secret_access_key: false };
  }
  return invoke<StorageCredentialsStatus>("clear_r2_credentials");
}

export async function uploadPastedImage(
  filenameHint: string,
  mimeType: string,
  dataBase64: string,
  activeFilePath?: string | null,
  rootDir?: string | null,
): Promise<UploadedAsset> {
  if (!isTauriRuntime()) {
    return {
      key: `preview-${Date.now()}`,
      url: `data:${mimeType};base64,${dataBase64}`,
      mime_type: mimeType,
      bytes: Math.floor((dataBase64.length * 3) / 4),
      synced: false,
    };
  }
  return invoke<UploadedAsset>("upload_pasted_image", {
    filenameHint,
    mimeType,
    dataBase64,
    activeFilePath: activeFilePath ?? null,
    rootDir: rootDir ?? null,
  });
}

export async function readImageDataUrl(path: string): Promise<string> {
  if (!isTauriRuntime()) {
    throw new Error("Not in Tauri runtime");
  }
  return invoke<string>("read_image_data_url", { path });
}

export async function openNewWindow(rootDir?: string | null, filePath?: string | null): Promise<string> {
  if (!isTauriRuntime()) return "browser-preview";
  return invoke<string>("open_new_window", {
    rootDir: rootDir ?? null,
    filePath: filePath ?? null,
  });
}

let folderDialogInFlight = false;

export async function pickFolderDialog(): Promise<string | null> {
  if (!isTauriRuntime() || folderDialogInFlight) return null;
  folderDialogInFlight = true;
  try {
    const result = await open({
      directory: true,
      multiple: false,
      title: "Open Folder in Nib",
    });
    return typeof result === "string" ? result : null;
  } catch (err) {
    console.error("Folder dialog failed:", err);
    return null;
  } finally {
    folderDialogInFlight = false;
  }
}

export async function confirmDialog(message: string, title = "Nib"): Promise<boolean> {
  if (!isTauriRuntime()) {
    return window.confirm(message);
  }
  try {
    return await confirm(message, { title, kind: "warning" });
  } catch {
    return false;
  }
}

export async function listenEvent<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return () => {};
  return listen<T>(event, (e) => handler(e.payload));
}
