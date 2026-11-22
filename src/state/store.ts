import { createMemo, createSignal } from "solid-js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { CursorMetrics } from "../editor/createEditor";
import type { VimModeLabel } from "../editor/vimExtension";
import { pluginRegistry } from "../plugins/registry";
import {
  DEFAULT_CONFIG,
  clearR2Credentials,
  copyPaths,
  createFolder,
  createNote,
  deleteNote,
  getConfig,
  getConfigPaths,
  getLocalState,
  getStorageCredentialsStatus,
  getWindowLaunchTarget,
  isTauriRuntime,
  listTrashedImages,
  movePaths,
  openInDefaultApp,
  openNewWindow,
  pickFolderDialog,
  purgeExpiredTrash,
  readDirectoryTree,
  readNote,
  refreshDirectoryTree,
  renamePath,
  saveGlobalConfig,
  saveLocalState,
  saveR2Credentials,
  unwatchDirectory,
  writeNote,
  type AppConfig,
  type ConfigPathsInfo,
  type FileNode,
  type SearchMode,
  type StorageCredentialsStatus,
} from "./ipc";

export type DockZone = "left" | "center" | "right" | "bottom";
export type PaneKind = "editor" | "explorer" | "properties";

export interface PaneTab {
  id: string;
  kind: PaneKind;
  zone: DockZone;
  title: string;
  path?: string | null;
  content?: string;
  dirty?: boolean;
}

let tabCounter = 1;
function makeEmptyEditorTab(zone: DockZone = "center"): PaneTab {
  return {
    id: `tab-${tabCounter++}`,
    kind: "editor",
    zone,
    path: null,
    title: "Untitled",
    content: "",
    dirty: false,
  };
}

function titleFromPath(path: string): string {
  const name = path.split("/").pop() ?? path;
  return name.replace(/\.(md|markdown)$/i, "");
}

export function createWindowStore() {
  const [config, setConfig] = createSignal<AppConfig>(structuredClone(DEFAULT_CONFIG));
  const [configPaths, setConfigPaths] = createSignal<ConfigPathsInfo>({
    global_config_file: "~/.config/nib/config.toml",
    local_state_file: "~/.local/state/nib/state.json",
    folder_config_file: null,
  });
  const [r2CredsStatus, setR2CredsStatus] = createSignal<StorageCredentialsStatus>({
    has_access_key_id: false,
    access_key_id_preview: null,
    has_secret_access_key: false,
  });
  const [rootDir, setRootDir] = createSignal<string | null>(null);
  const [fileTree, setFileTree] = createSignal<FileNode[]>([]);

  // Unified Dock / Pane / Tab ecosystem (VS Code / Obsidian model)
  const initialEditor = makeEmptyEditorTab("center");
  const initialPanes: PaneTab[] = [
    { id: "pane-explorer", kind: "explorer", zone: "left", title: "Explorer" },
    { id: "pane-properties", kind: "properties", zone: "left", title: "Properties" },
    initialEditor,
  ];

  const [panes, setPanes] = createSignal<PaneTab[]>(initialPanes);
  const [activeByZone, setActiveByZone] = createSignal<Record<DockZone, string | null>>({
    left: "pane-explorer",
    center: initialEditor.id,
    right: null,
    bottom: null,
  });
  const [activeEditorId, setActiveEditorId] = createSignal<string>(initialEditor.id);
  const [focusedZone, setFocusedZone] = createSignal<DockZone>("center");
  const [draggingTabId, setDraggingTabId] = createSignal<string | null>(null);
  const [fileLoadVersion, setFileLoadVersion] = createSignal<number>(0);

  const [leftVisible, setLeftVisible] = createSignal<boolean>(
    typeof window !== "undefined" ? window.innerWidth > 768 : true,
  );
  const [rightVisible, setRightVisible] = createSignal<boolean>(false);
  const [bottomVisible, setBottomVisible] = createSignal<boolean>(false);

  const [mobileTabsOpen, setMobileTabsOpen] = createSignal<boolean>(false);

  const zonePanes = (zone: DockZone) => panes().filter((p) => p.zone === zone);
  const editorTabs = createMemo(() => panes().filter((p) => p.kind === "editor"));

  const activeEditorTab = createMemo<PaneTab | undefined>(() => {
    const eds = editorTabs();
    return eds.find((t) => t.id === activeEditorId()) ?? eds[0];
  });

  const activeFilePath = () => activeEditorTab()?.path ?? null;
  const content = () => activeEditorTab()?.content ?? "";
  const dirty = () => activeEditorTab()?.dirty ?? false;

  const updatePane = (id: string, patch: Partial<PaneTab>) => {
    setPanes((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const setContent = (next: string) => {
    const ed = activeEditorTab();
    if (ed) updatePane(ed.id, { content: next });
  };
  const setDirty = (next: boolean) => {
    const ed = activeEditorTab();
    if (ed) updatePane(ed.id, { dirty: next });
  };

  // Focus bridge per editor pane / explorer / properties
  const editorFocusMap = new Map<string, () => void>();
  const registerEditorFocus = (tabId: string, fn: () => void) => {
    editorFocusMap.set(tabId, fn);
  };
  const unregisterEditorFocus = (tabId: string) => {
    editorFocusMap.delete(tabId);
  };

  const focusActiveEditor = () => {
    const ed = activeEditorTab();
    if (!ed) return;
    setFocusedZone(ed.zone);
    setActiveByZone((prev) => ({ ...prev, [ed.zone]: ed.id }));
    queueMicrotask(() => {
      editorFocusMap.get(ed.id)?.();
    });
  };

  const activeKindInZone = (zone: DockZone): PaneKind | null => {
    const id = activeByZone()[zone];
    const p = panes().find((x) => x.id === id && x.zone === zone) ?? zonePanes(zone)[0];
    return p?.kind ?? null;
  };

  // Backwards-compatible focus area helper
  const focusArea = (): "editor" | "explorer" | "properties" => {
    const z = focusedZone();
    const kind = activeKindInZone(z);
    if (kind === "explorer") return "explorer";
    if (kind === "properties") return "properties";
    return "editor";
  };

  const isZoneVisible = (zone: DockZone): boolean => {
    if (zone === "center") return true;
    if (zone === "left") return leftVisible() && zonePanes("left").length > 0;
    if (zone === "right") return rightVisible() && zonePanes("right").length > 0;
    return bottomVisible() && zonePanes("bottom").length > 0;
  };

  const setZoneVisible = (zone: DockZone, visible: boolean) => {
    if (zone === "left") setLeftVisible(visible);
    else if (zone === "right") setRightVisible(visible);
    else if (zone === "bottom") setBottomVisible(visible);
  };

  const [settingsOpen, setSettingsOpen] = createSignal<boolean>(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = createSignal<boolean>(false);
  const [searchModalOpen, setSearchModalOpen] = createSignal<boolean>(false);
  const [searchMode, setSearchMode] = createSignal<SearchMode>("omni");
  const [pendingJumpLine, setPendingJumpLine] = createSignal<number | null>(null);
  const [toast, setToast] = createSignal<string | null>(null);
  const [trashedCount, setTrashedCount] = createSignal<number>(0);
  const [sidebarCreateMode, setSidebarCreateMode] = createSignal<"note" | "folder" | null>(null);
  let toastTimer: number | undefined;
  let autoSaveTimer: number | undefined;

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer !== undefined) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => setToast(null), 2200);
  };

  const [vimMode, setVimMode] = createSignal<VimModeLabel>("NORMAL");
  const [cursor, setCursor] = createSignal<CursorMetrics>({
    line: 1,
    col: 1,
    words: 0,
    chars: 0,
  });

  const applyThemeTokens = (cfg: AppConfig) => {
    const root = document.documentElement;
    if (cfg.appearance.theme === "light" || cfg.appearance.theme === "dark") {
      root.setAttribute("data-theme", cfg.appearance.theme);
    } else {
      root.removeAttribute("data-theme");
    }
    if (isTauriRuntime()) {
      const nativeTheme =
        cfg.appearance.theme === "light" || cfg.appearance.theme === "dark"
          ? cfg.appearance.theme
          : null;
      void getCurrentWindow().setTheme(nativeTheme).catch(() => {});
    }
    root.style.setProperty("--nib-font-sans", cfg.editor.font_family);
    root.style.setProperty("--nib-font-mono", cfg.editor.mono_font_family);
    root.style.setProperty("--nib-editor-font-size", `${cfg.editor.font_size}px`);
    root.style.setProperty("--nib-editor-line-height", String(cfg.editor.line_height));
  };

  const loadFolder = async (folder: string) => {
    const prev = rootDir();
    if (prev && prev !== folder) {
      await unwatchDirectory(prev);
    }
    try {
      const [tree, effConfig, paths, local] = await Promise.all([
        readDirectoryTree(folder),
        getConfig(folder),
        getConfigPaths(folder),
        getLocalState(),
      ]);
      setRootDir(folder);
      setFileTree(tree);
      setConfig(effConfig);
      setConfigPaths(paths);
      applyThemeTokens(effConfig);

      const recent = [folder, ...local.recent_paths.filter((p) => p !== folder)].slice(0, 10);
      await saveLocalState({ ...local, recent_paths: recent });
    } catch (err) {
      showToast(String(err));
    }
  };

  const refreshTree = async () => {
    const dir = rootDir();
    if (!dir) return;
    try {
      const tree = await refreshDirectoryTree(dir);
      setFileTree(tree);
    } catch {
      // Directory may have been moved or unmounted
    }
  };

  const savePane = async (tab: PaneTab, silent = false) => {
    if (tab.kind !== "editor" || !tab.path) return;
    if (autoSaveTimer !== undefined) {
      window.clearTimeout(autoSaveTimer);
      autoSaveTimer = undefined;
    }
    await writeNote(tab.path, tab.content ?? "");
    updatePane(tab.id, { dirty: false });
    if (!silent) showToast("Saved");
  };

  const saveActiveFile = async (silent = false) => {
    const tab = activeEditorTab();
    if (!tab || !tab.path) return;
    await savePane(tab, silent);
  };

  const selectPane = async (id: string, focus = true) => {
    const target = panes().find((p) => p.id === id);
    if (!target) return;

    const currentEd = activeEditorTab();
    if (target.kind === "editor" && currentEd && currentEd.id !== target.id && currentEd.dirty && currentEd.path) {
      await savePane(currentEd, true);
    }

    setActiveByZone((prev) => ({ ...prev, [target.zone]: target.id }));
    setZoneVisible(target.zone, true);

    if (target.kind === "editor") {
      setActiveEditorId(target.id);
      setFileLoadVersion((v) => v + 1);
    }
    if (focus) {
      setFocusedZone(target.zone);
      if (target.kind === "editor") {
        queueMicrotask(() => editorFocusMap.get(target.id)?.());
      }
    }
  };

  const moveTabToZone = (tabId: string, targetZone: DockZone) => {
    const tab = panes().find((p) => p.id === tabId);
    if (!tab || tab.zone === targetZone) return;

    const sourceZone = tab.zone;
    setPanes((prev) => prev.map((p) => (p.id === tabId ? { ...p, zone: targetZone } : p)));

    // Ensure source zone selects a remaining tab (or ensures center always has a tab)
    const remainingInSource = panes().filter((p) => p.zone === sourceZone);
    if (remainingInSource.length === 0 && sourceZone === "center") {
      const fresh = makeEmptyEditorTab("center");
      setPanes((prev) => [...prev, fresh]);
      setActiveByZone((prev) => ({ ...prev, center: fresh.id }));
    } else {
      setActiveByZone((prev) => ({
        ...prev,
        [sourceZone]: remainingInSource[0]?.id ?? null,
      }));
      if (remainingInSource.length === 0 && sourceZone !== "center") {
        setZoneVisible(sourceZone, false);
      }
    }

    setActiveByZone((prev) => ({ ...prev, [targetZone]: tabId }));
    setZoneVisible(targetZone, true);
    setFocusedZone(targetZone);
    if (tab.kind === "editor") {
      setActiveEditorId(tabId);
    }
  };

  const openEmptyTab = (zone: DockZone = "center") => {
    const fresh = makeEmptyEditorTab(zone);
    setPanes((prev) => [...prev, fresh]);
    setActiveByZone((prev) => ({ ...prev, [zone]: fresh.id }));
    setActiveEditorId(fresh.id);
    setZoneVisible(zone, true);
    setFocusedZone(zone);
    setFileLoadVersion((v) => v + 1);
    queueMicrotask(() => editorFocusMap.get(fresh.id)?.());
  };

  const closeTab = async (id?: string) => {
    const targetId = id ?? activeByZone()[focusedZone()] ?? activeEditorId();
    const target = panes().find((p) => p.id === targetId);
    if (!target || target.kind !== "editor") return;

    if (target.dirty && target.path) {
      await savePane(target, true);
    }

    const sameZoneEditors = panes().filter((p) => p.zone === target.zone && p.kind === "editor");
    const allEditors = editorTabs();

    if (allEditors.length <= 1) {
      if (!target.path && (target.content ?? "") === "") {
        if (isTauriRuntime()) {
          await getCurrentWindow().close();
        }
        return;
      }
      updatePane(target.id, { path: null, title: "Untitled", content: "", dirty: false });
      setFileLoadVersion((v) => v + 1);
      return;
    }

    const idx = sameZoneEditors.findIndex((t) => t.id === target.id);
    setPanes((prev) => prev.filter((p) => p.id !== target.id));

    const remainingInZone = panes().filter((p) => p.zone === target.zone);
    if (remainingInZone.length > 0) {
      const next = remainingInZone[Math.min(idx, remainingInZone.length - 1)];
      setActiveByZone((prev) => ({ ...prev, [target.zone]: next.id }));
      if (next.kind === "editor") setActiveEditorId(next.id);
    } else {
      setActiveByZone((prev) => ({ ...prev, [target.zone]: null }));
      if (target.zone !== "center") setZoneVisible(target.zone, false);
    }

    if (activeEditorId() === target.id) {
      const fallback = editorTabs()[0];
      if (fallback) {
        setActiveEditorId(fallback.id);
        setActiveByZone((prev) => ({ ...prev, [fallback.zone]: fallback.id }));
      }
    }
    setFileLoadVersion((v) => v + 1);
  };

  const cycleTabs = (delta: 1 | -1) => {
    const zone = focusedZone();
    const list = zonePanes(zone);
    const targetList = list.length > 1 ? list : zonePanes("center");
    if (targetList.length <= 1) return;
    const z = targetList[0].zone;
    const curId = activeByZone()[z];
    const idx = Math.max(0, targetList.findIndex((p) => p.id === curId));
    const next = targetList[(idx + delta + targetList.length) % targetList.length];
    void selectPane(next.id, true);
  };

  const nextTab = () => cycleTabs(1);
  const prevTab = () => cycleTabs(-1);

  const openFile = async (path: string, line?: number | null) => {
    const existing = editorTabs().find((t) => t.path === path);
    if (existing) {
      await selectPane(existing.id, true);
      if (line && line > 0) setPendingJumpLine(line);
      return;
    }

    const current = activeEditorTab();
    if (current?.dirty && current.path) {
      await savePane(current, true);
    }

    const text = await readNote(path);
    const reuseEmpty = current && !current.path && (current.content ?? "") === "";
    if (reuseEmpty && current) {
      updatePane(current.id, {
        path,
        title: titleFromPath(path),
        content: text,
        dirty: false,
      });
      setActiveEditorId(current.id);
      setActiveByZone((prev) => ({ ...prev, [current.zone]: current.id }));
      setFileLoadVersion((v) => v + 1);
    } else {
      const zone: DockZone = current?.zone ?? "center";
      const newTab: PaneTab = {
        id: `tab-${tabCounter++}`,
        kind: "editor",
        zone,
        path,
        title: titleFromPath(path),
        content: text,
        dirty: false,
      };
      setPanes((prev) => [...prev, newTab]);
      setActiveByZone((prev) => ({ ...prev, [zone]: newTab.id }));
      setActiveEditorId(newTab.id);
      setFileLoadVersion((v) => v + 1);
    }

    if (line && line > 0) {
      setPendingJumpLine(line);
    }
    if (typeof window !== "undefined" && window.innerWidth <= 768) {
      setLeftVisible(false);
    }
    const local = await getLocalState();
    await saveLocalState({ ...local, last_opened_file: path });
  };

  const onEditorContentChange = (next: string, tabId?: string) => {
    const id = tabId ?? activeEditorId();
    updatePane(id, { content: next, dirty: true });
    const delay = config().editor.auto_save_ms;
    const tab = panes().find((p) => p.id === id);
    if (delay > 0 && tab?.path) {
      if (autoSaveTimer !== undefined) window.clearTimeout(autoSaveTimer);
      autoSaveTimer = window.setTimeout(() => {
        const latest = panes().find((p) => p.id === id);
        if (latest) void savePane(latest, true);
      }, delay);
    }
  };

  const focusKind = (kind: "explorer" | "properties") => {
    const pane = panes().find((p) => p.kind === kind);
    if (!pane) return;
    if (isZoneVisible(pane.zone) && activeByZone()[pane.zone] === pane.id && focusedZone() === pane.zone) {
      focusActiveEditor();
      return;
    }
    setZoneVisible(pane.zone, true);
    setActiveByZone((prev) => ({ ...prev, [pane.zone]: pane.id }));
    setFocusedZone(pane.zone);
  };

  const toggleSidebar = async () => {
    const next = !leftVisible();
    setLeftVisible(next);
    if (!next && focusedZone() === "left") {
      focusActiveEditor();
    }
    const local = await getLocalState();
    await saveLocalState({ ...local, sidebar_visible: next });
  };

  const createNewNote = async () => {
    if (!rootDir()) {
      const picked = await pickFolderDialog();
      if (!picked) return;
      await loadFolder(picked);
    }
    const exp = panes().find((p) => p.kind === "explorer");
    if (exp) {
      setZoneVisible(exp.zone, true);
      setActiveByZone((prev) => ({ ...prev, [exp.zone]: exp.id }));
    }
    setSidebarCreateMode("note");
  };

  const createNoteInline = async (name: string, parentDir?: string | null) => {
    const targetDir = parentDir ?? rootDir();
    if (!targetDir || !name.trim()) return;
    try {
      const createdPath = await createNote(targetDir, name.trim());
      setSidebarCreateMode(null);
      await refreshTree();
      await openFile(createdPath);
      focusActiveEditor();
    } catch (err) {
      showToast(String(err));
    }
  };

  const createFolderInline = async (name: string, parentDir?: string | null) => {
    const targetDir = parentDir ?? rootDir();
    if (!targetDir || !name.trim()) return;
    try {
      await createFolder(targetDir, name.trim());
      setSidebarCreateMode(null);
      await refreshTree();
    } catch (err) {
      showToast(String(err));
    }
  };

  const renameItem = async (oldPath: string, newName: string) => {
    if (!newName.trim()) return;
    try {
      const updated = await renamePath(oldPath, newName.trim());
      setPanes((prev) =>
        prev.map((t) =>
          t.path === oldPath ? { ...t, path: updated, title: titleFromPath(updated) } : t,
        ),
      );
      await refreshTree();
    } catch (err) {
      showToast(String(err));
    }
  };

  const deleteItem = async (path: string) => {
    try {
      await deleteNote(path);
      const openTab = editorTabs().find((t) => t.path === path);
      if (openTab) {
        await closeTab(openTab.id);
      }
      await refreshTree();
    } catch (err) {
      showToast(String(err));
    }
  };

  const moveItems = async (sources: string[], targetDir: string) => {
    try {
      const moved = await movePaths(sources, targetDir);
      await refreshTree();
      showToast(`Moved ${moved.length}`);
    } catch (err) {
      showToast(String(err));
    }
  };

  const copyItems = async (sources: string[], targetDir: string) => {
    try {
      const copied = await copyPaths(sources, targetDir);
      await refreshTree();
      showToast(`Copied ${copied.length}`);
    } catch (err) {
      showToast(String(err));
    }
  };

  const openExternal = async (path: string) => {
    try {
      await openInDefaultApp(path);
    } catch (err) {
      showToast(String(err));
    }
  };

  const openFolderPicker = async () => {
    const picked = await pickFolderDialog();
    if (!picked) return;
    await loadFolder(picked);
  };

  const openAnotherWindow = async (dir?: string | null, file?: string | null) => {
    await openNewWindow(dir ?? rootDir(), file ?? null);
  };

  const updateConfig = async (next: AppConfig) => {
    setConfig(next);
    applyThemeTokens(next);
    await saveGlobalConfig(next);
  };

  const toggleVimMode = async () => {
    const current = config();
    await updateConfig({
      ...current,
      editor: { ...current.editor, vim_mode: !current.editor.vim_mode },
    });
  };

  const toggleRenderMarkdown = async () => {
    const current = config();
    await updateConfig({
      ...current,
      editor: { ...current.editor, render_markdown: !current.editor.render_markdown },
    });
  };

  const toggleTopbar = async () => {
    const cur = config();
    await updateConfig({ ...cur, ui: { ...cur.ui, show_topbar: !cur.ui.show_topbar } });
  };

  const toggleStatusbar = async () => {
    const cur = config();
    await updateConfig({ ...cur, ui: { ...cur.ui, show_statusbar: !cur.ui.show_statusbar } });
  };

  const openSearch = (mode: SearchMode) => {
    setCommandPaletteOpen(false);
    setSettingsOpen(false);
    setMobileTabsOpen(false);
    setSearchMode(mode);
    setSearchModalOpen(true);
  };

  const openCommandPalette = () => {
    setSearchModalOpen(false);
    setSettingsOpen(false);
    setMobileTabsOpen(false);
    setCommandPaletteOpen(true);
  };

  const openSettings = () => {
    setSearchModalOpen(false);
    setCommandPaletteOpen(false);
    setMobileTabsOpen(false);
    setSettingsOpen(true);
  };

  const refreshTrashCount = async () => {
    const entries = await listTrashedImages();
    setTrashedCount(entries.length);
  };

  const purgeTrash = async () => {
    const count = await purgeExpiredTrash();
    await refreshTrashCount();
    showToast(count > 0 ? `Purged ${count}` : "Nothing to purge");
  };

  const refreshR2CredsStatus = async () => {
    const status = await getStorageCredentialsStatus();
    setR2CredsStatus(status);
  };

  const saveR2Creds = async (accessKeyId?: string | null, secretAccessKey?: string | null) => {
    const status = await saveR2Credentials(accessKeyId, secretAccessKey);
    setR2CredsStatus(status);
  };

  const clearR2Creds = async () => {
    const status = await clearR2Credentials();
    setR2CredsStatus(status);
  };

  const registerBuiltinCommands = () => {
    const defs = [
      { id: "nib:save", title: "Save", category: "File", defaultKeybinding: "Mod-s", run: () => void saveActiveFile() },
      { id: "nib:new-note", title: "New Note", category: "File", defaultKeybinding: "Mod-n", run: () => void createNewNote() },
      { id: "nib:new-tab", title: "New Tab", category: "Tab", defaultKeybinding: "Mod-t", run: () => openEmptyTab() },
      { id: "nib:close-tab", title: "Close Tab", category: "Tab", defaultKeybinding: "Mod-w", run: () => void closeTab() },
      { id: "nib:next-tab", title: "Next Tab", category: "Tab", defaultKeybinding: "Mod-Shift-]", run: () => nextTab() },
      { id: "nib:prev-tab", title: "Previous Tab", category: "Tab", defaultKeybinding: "Mod-Shift-[", run: () => prevTab() },
      { id: "nib:new-window", title: "New Window", category: "Window", defaultKeybinding: "Mod-Shift-n", run: () => void openAnotherWindow() },
      { id: "nib:open-folder", title: "Open Folder", category: "File", defaultKeybinding: "Mod-o", run: () => void openFolderPicker() },
      { id: "nib:toggle-sidebar", title: "Toggle Left Panel", category: "View", defaultKeybinding: "Mod-Shift-s", run: () => void toggleSidebar() },
      { id: "nib:focus-explorer", title: "Focus Explorer", category: "Panel", defaultKeybinding: "Mod-Ctrl-1", run: () => focusKind("explorer") },
      { id: "nib:focus-properties", title: "Focus Properties", category: "Panel", defaultKeybinding: "Mod-Ctrl-2", run: () => focusKind("properties") },
      { id: "nib:toggle-topbar", title: "Toggle Tab Bar", category: "View", run: () => void toggleTopbar() },
      { id: "nib:toggle-statusbar", title: "Toggle Status Bar", category: "View", run: () => void toggleStatusbar() },
      { id: "nib:toggle-vim", title: "Toggle Vim Mode", category: "Editor", defaultKeybinding: "Mod-Shift-v", run: () => void toggleVimMode() },
      { id: "nib:toggle-render-markdown", title: "Toggle Markdown Render", category: "Editor", defaultKeybinding: "Mod-Shift-m", run: () => void toggleRenderMarkdown() },
      { id: "nib:open-settings", title: "Settings", category: "App", defaultKeybinding: "Mod-,", run: () => openSettings() },
      { id: "nib:command-palette", title: "Command Palette", category: "App", defaultKeybinding: "Mod-Shift-p", run: () => openCommandPalette() },
      { id: "nib:search-omni", title: "Omni Search", category: "Search", defaultKeybinding: "Mod-k", run: () => openSearch("omni") },
      { id: "nib:search-files", title: "Find File", category: "Search", defaultKeybinding: "Mod-Shift-o", run: () => openSearch("files") },
      { id: "nib:search-content", title: "Search Content", category: "Search", defaultKeybinding: "Mod-Shift-f", run: () => openSearch("content") },
      { id: "nib:search-tags", title: "Search Tags", category: "Search", defaultKeybinding: "Mod-Shift-t", run: () => openSearch("tags") },
    ];

    const disposers = defs.map((cmd) => pluginRegistry.registerCommand(cmd));
    return () => {
      for (const d of disposers) d();
    };
  };

  const bootstrap = async () => {
    const [target, local, initialConfig, paths, creds] = await Promise.all([
      getWindowLaunchTarget(),
      getLocalState(),
      getConfig(null),
      getConfigPaths(null),
      getStorageCredentialsStatus(),
    ]);

    const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;
    setLeftVisible(isMobile ? false : local.sidebar_visible);
    setConfig(initialConfig);
    setConfigPaths(paths);
    setR2CredsStatus(creds);
    applyThemeTokens(initialConfig);

    if (target.root_dir) {
      await loadFolder(target.root_dir);
    }

    if (target.file_path) {
      await openFile(target.file_path);
    } else if (initialConfig.startup_behavior === "last_note" && local.last_opened_file) {
      try {
        await openFile(local.last_opened_file);
      } catch {
        // Stay on clean empty tab
      }
    }
  };

  return {
    config,
    setConfig,
    applyThemeTokens,
    configPaths,
    r2CredsStatus,
    refreshR2CredsStatus,
    saveR2Creds,
    clearR2Creds,
    rootDir,
    fileTree,
    panes,
    zonePanes,
    editorTabs,
    activeByZone,
    activeEditorId,
    activeEditorTab,
    activeFilePath,
    content,
    setContent,
    fileLoadVersion,
    dirty,
    setDirty,
    focusedZone,
    setFocusedZone,
    focusArea,
    draggingTabId,
    setDraggingTabId,
    leftVisible,
    setLeftVisible,
    rightVisible,
    setRightVisible,
    bottomVisible,
    setBottomVisible,
    isZoneVisible,
    setZoneVisible,
    mobileTabsOpen,
    setMobileTabsOpen,
    registerEditorFocus,
    unregisterEditorFocus,
    focusEditor: focusActiveEditor,
    selectPane,
    moveTabToZone,
    openEmptyTab,
    closeTab,
    nextTab,
    prevTab,
    settingsOpen,
    setSettingsOpen,
    commandPaletteOpen,
    setCommandPaletteOpen,
    searchModalOpen,
    setSearchModalOpen,
    searchMode,
    setSearchMode,
    pendingJumpLine,
    setPendingJumpLine,
    toast,
    showToast,
    trashedCount,
    refreshTrashCount,
    purgeTrash,
    sidebarCreateMode,
    setSidebarCreateMode,
    vimMode,
    setVimMode,
    cursor,
    setCursor,
    bootstrap,
    registerBuiltinCommands,
    loadFolder,
    refreshTree,
    openFile,
    saveActiveFile,
    onEditorContentChange,
    createNewNote,
    createNoteInline,
    createFolderInline,
    renameItem,
    moveItems,
    copyItems,
    openExternal,
    deleteItem,
    openFolderPicker,
    openAnotherWindow,
    updateConfig,
    toggleVimMode,
    toggleRenderMarkdown,
    toggleSidebar,
    focusKind,
    toggleTopbar,
    toggleStatusbar,
    openSearch,
    openCommandPalette,
    openSettings,
  };
}

export type WindowStore = ReturnType<typeof createWindowStore>;
