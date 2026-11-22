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
  type LineNumberMode,
  type RenderMode,
  type SearchMode,
  type StorageCredentialsStatus,
} from "./ipc";

/**
 * Official Nib UI Hierarchy:
 *   Window -> Panel ("left" | "center" | "right" | "bottom")
 *          -> Pane (tmux-style split regions inside a Panel; starts with 1, splittable to N)
 *          -> Container (tabs inside a Pane: "editor" | "explorer" | "properties")
 */
export type PanelId = "left" | "center" | "right" | "bottom";
export type ContainerKind = "editor" | "explorer" | "properties";

export interface PaneNode {
  id: string;
  panel: PanelId;
  activeContainerId: string | null;
}

export interface ContainerTab {
  id: string;
  kind: ContainerKind;
  paneId: string;
  title: string;
  path?: string | null;
  content?: string;
  dirty?: boolean;
}

let containerCounter = 1;
let paneCounter = 10;

function makeEmptyEditorContainer(paneId: string): ContainerTab {
  return {
    id: `container-editor-${containerCounter++}`,
    kind: "editor",
    paneId,
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

  // Initial Panel -> Pane -> Container tree
  const initialEditor = makeEmptyEditorContainer("pane-main-1");
  const initialPanes: PaneNode[] = [
    { id: "pane-left-1", panel: "left", activeContainerId: "container-explorer" },
    { id: "pane-main-1", panel: "center", activeContainerId: initialEditor.id },
    { id: "pane-right-1", panel: "right", activeContainerId: null },
    { id: "pane-bottom-1", panel: "bottom", activeContainerId: null },
  ];
  const initialContainers: ContainerTab[] = [
    { id: "container-explorer", kind: "explorer", paneId: "pane-left-1", title: "Explorer" },
    { id: "container-properties", kind: "properties", paneId: "pane-left-1", title: "Properties" },
    initialEditor,
  ];

  const [panes, setPanes] = createSignal<PaneNode[]>(initialPanes);
  const [containers, setContainers] = createSignal<ContainerTab[]>(initialContainers);
  const [activePaneId, setActivePaneId] = createSignal<string>("pane-main-1");
  const [lastPaneByPanel, setLastPaneByPanel] = createSignal<Record<PanelId, string>>({
    left: "pane-left-1",
    center: "pane-main-1",
    right: "pane-right-1",
    bottom: "pane-bottom-1",
  });
  const [activeEditorId, setActiveEditorId] = createSignal<string>(initialEditor.id);
  const [draggingContainerId, setDraggingContainerId] = createSignal<string | null>(null);
  const [fileLoadVersion, setFileLoadVersion] = createSignal<number>(0);

  const [leftVisible, setLeftVisible] = createSignal<boolean>(
    typeof window !== "undefined" ? window.innerWidth > 768 : true,
  );
  const [rightVisible, setRightVisible] = createSignal<boolean>(false);
  const [bottomVisible, setBottomVisible] = createSignal<boolean>(false);
  const [mobileTabsOpen, setMobileTabsOpen] = createSignal<boolean>(false);

  // Derived helpers
  const panesInPanel = (panel: PanelId) => panes().filter((p) => p.panel === panel);
  const containersInPane = (paneId: string) => containers().filter((c) => c.paneId === paneId);
  const getPane = (paneId: string) => panes().find((p) => p.id === paneId);
  const panelOfPane = (paneId: string): PanelId => getPane(paneId)?.panel ?? "center";
  const focusedPanel = (): PanelId => panelOfPane(activePaneId());

  const activeContainerInPane = (paneId: string): ContainerTab | undefined => {
    const pane = getPane(paneId);
    const list = containersInPane(paneId);
    if (!pane) return list[0];
    return list.find((c) => c.id === pane.activeContainerId) ?? list[0];
  };

  const editorContainers = createMemo(() => containers().filter((c) => c.kind === "editor"));
  const activeEditorContainer = createMemo<ContainerTab | undefined>(() => {
    const eds = editorContainers();
    return eds.find((c) => c.id === activeEditorId()) ?? eds[0];
  });

  const activeFilePath = () => activeEditorContainer()?.path ?? null;
  const content = () => activeEditorContainer()?.content ?? "";
  const dirty = () => activeEditorContainer()?.dirty ?? false;

  const updateContainer = (id: string, patch: Partial<ContainerTab>) => {
    setContainers((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const updatePane = (id: string, patch: Partial<PaneNode>) => {
    setPanes((prev) => {
      const cur = prev.find((p) => p.id === id);
      if (!cur) return prev;
      if (
        (patch.panel === undefined || patch.panel === cur.panel) &&
        (patch.activeContainerId === undefined || patch.activeContainerId === cur.activeContainerId)
      ) {
        return prev;
      }
      return prev.map((p) => (p.id === id ? { ...p, ...patch } : p));
    });
  };

  const setContent = (next: string) => {
    const ed = activeEditorContainer();
    if (ed) updateContainer(ed.id, { content: next });
  };

  const setDirty = (next: boolean) => {
    const ed = activeEditorContainer();
    if (ed) updateContainer(ed.id, { dirty: next });
  };

  // Focus bridges for Editor, Explorer, Properties, and empty Panes
  const editorFocusMap = new Map<string, () => void>();
  const registerEditorFocus = (containerId: string, fn: () => void) => {
    editorFocusMap.set(containerId, fn);
  };
  const unregisterEditorFocus = (containerId: string) => {
    editorFocusMap.delete(containerId);
  };

  const isPanelVisible = (panel: PanelId): boolean => {
    if (panel === "center") return true;
    if (panel === "left") return leftVisible();
    if (panel === "right") return rightVisible();
    return bottomVisible();
  };

  const setPanelVisible = (panel: PanelId, visible: boolean) => {
    if (panel === "left") setLeftVisible(visible);
    else if (panel === "right") setRightVisible(visible);
    else if (panel === "bottom") setBottomVisible(visible);
  };

  const createPaneInPanel = (panel: PanelId): PaneNode => {
    const node: PaneNode = {
      id: `pane-${panel}-${paneCounter++}`,
      panel,
      activeContainerId: null,
    };
    setPanes((prev) => [...prev, node]);
    return node;
  };

  const focusPane = (paneId: string, focusDom = true) => {
    const pane = getPane(paneId);
    if (!pane) return;
    if (!isPanelVisible(pane.panel)) {
      setPanelVisible(pane.panel, true);
    }
    if (activePaneId() !== pane.id) {
      setActivePaneId(pane.id);
    }
    if (lastPaneByPanel()[pane.panel] !== pane.id) {
      setLastPaneByPanel((prev) => ({ ...prev, [pane.panel]: pane.id }));
    }

    const active = activeContainerInPane(pane.id);
    if (active) {
      if (pane.activeContainerId !== active.id) {
        updatePane(pane.id, { activeContainerId: active.id });
      }
      if (active.kind === "editor") {
        if (activeEditorId() !== active.id) {
          setActiveEditorId(active.id);
        }
        if (focusDom) {
          queueMicrotask(() => editorFocusMap.get(active.id)?.());
        }
      }
    }
  };

  const focusMainPanel = () => {
    const mainPanes = panesInPanel("center");
    const preferred =
      mainPanes.find((p) => p.id === lastPaneByPanel().center) ?? mainPanes[0];
    if (preferred) {
      focusPane(preferred.id);
      return;
    }
    const ed = activeEditorContainer();
    if (ed) focusPane(ed.paneId);
  };

  const focusActiveEditor = () => {
    const ed = activeEditorContainer();
    if (!ed) {
      focusMainPanel();
      return;
    }
    const panel = panelOfPane(ed.paneId);
    setPanelVisible(panel, true);
    updatePane(ed.paneId, { activeContainerId: ed.id });
    setActivePaneId(ed.paneId);
    setLastPaneByPanel((prev) => ({ ...prev, [panel]: ed.paneId }));
    queueMicrotask(() => editorFocusMap.get(ed.id)?.());
  };

  /**
   * Master Panel Toggle-and-Focus state machine (for Left / Right / Bottom Panels):
   * 1. Closed              -> open Panel & focus it
   * 2. Open & unfocused    -> focus Panel
   * 3. Open & focused      -> close Panel & return focus to Main Panel
   */
  const togglePanel = async (panel: "left" | "right" | "bottom") => {
    if (!isPanelVisible(panel)) {
      setPanelVisible(panel, true);
      let pane =
        panesInPanel(panel).find((p) => p.id === lastPaneByPanel()[panel]) ??
        panesInPanel(panel)[0];
      if (!pane) pane = createPaneInPanel(panel);
      focusPane(pane.id);
      if (panel === "left") {
        const local = await getLocalState();
        await saveLocalState({ ...local, sidebar_visible: true });
      }
      return;
    }

    if (focusedPanel() !== panel) {
      let pane =
        panesInPanel(panel).find((p) => p.id === lastPaneByPanel()[panel]) ??
        panesInPanel(panel)[0];
      if (!pane) pane = createPaneInPanel(panel);
      focusPane(pane.id);
      return;
    }

    setPanelVisible(panel, false);
    focusMainPanel();
    if (panel === "left") {
      const local = await getLocalState();
      await saveLocalState({ ...local, sidebar_visible: false });
    }
  };

  /** Simple visibility toggle for pointer/icon clicks (header toggle button & mobile drawer). */
  const togglePanelVisibility = async (panel: "left" | "right" | "bottom") => {
    const next = !isPanelVisible(panel);
    setPanelVisible(panel, next);
    if (!next && focusedPanel() === panel) {
      focusMainPanel();
    }
    if (panel === "left") {
      const local = await getLocalState();
      await saveLocalState({ ...local, sidebar_visible: next });
    }
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

  const saveContainer = async (tab: ContainerTab, silent = false) => {
    if (tab.kind !== "editor" || !tab.path) return;
    if (autoSaveTimer !== undefined) {
      window.clearTimeout(autoSaveTimer);
      autoSaveTimer = undefined;
    }
    await writeNote(tab.path, tab.content ?? "");
    updateContainer(tab.id, { dirty: false });
    if (!silent) showToast("Saved");
  };

  const saveActiveFile = async (silent = false) => {
    const tab = activeEditorContainer();
    if (!tab || !tab.path) return;
    await saveContainer(tab, silent);
  };

  const selectContainer = async (containerId: string, focus = true) => {
    const target = containers().find((c) => c.id === containerId);
    if (!target) return;

    const currentEd = activeEditorContainer();
    if (
      target.kind === "editor" &&
      currentEd &&
      currentEd.id !== target.id &&
      currentEd.dirty &&
      currentEd.path
    ) {
      await saveContainer(currentEd, true);
    }

    const panel = panelOfPane(target.paneId);
    if (!isPanelVisible(panel)) setPanelVisible(panel, true);
    updatePane(target.paneId, { activeContainerId: target.id });

    if (target.kind === "editor") {
      if (activeEditorId() !== target.id) {
        setActiveEditorId(target.id);
        setFileLoadVersion((v) => v + 1);
      }
    }
    if (focus) {
      if (activePaneId() !== target.paneId) setActivePaneId(target.paneId);
      if (lastPaneByPanel()[panel] !== target.paneId) {
        setLastPaneByPanel((prev) => ({ ...prev, [panel]: target.paneId }));
      }
      if (target.kind === "editor") {
        queueMicrotask(() => editorFocusMap.get(target.id)?.());
      }
    }
  };

  const moveContainerToPane = (containerId: string, targetPaneId: string) => {
    const container = containers().find((c) => c.id === containerId);
    const targetPane = getPane(targetPaneId);
    if (!container || !targetPane || container.paneId === targetPaneId) return;

    const sourcePaneId = container.paneId;
    const sourcePanel = panelOfPane(sourcePaneId);

    updateContainer(containerId, { paneId: targetPaneId });

    const remainingInSource = containersInPane(sourcePaneId);
    if (remainingInSource.length === 0) {
      if (sourcePanel === "center" && panesInPanel("center").length === 1) {
        const fresh = makeEmptyEditorContainer(sourcePaneId);
        setContainers((prev) => [...prev, fresh]);
        updatePane(sourcePaneId, { activeContainerId: fresh.id });
      } else if (panesInPanel(sourcePanel).length > 1) {
        setPanes((prev) => prev.filter((p) => p.id !== sourcePaneId));
      } else {
        updatePane(sourcePaneId, { activeContainerId: null });
      }
    } else {
      updatePane(sourcePaneId, { activeContainerId: remainingInSource[0].id });
    }

    updatePane(targetPaneId, { activeContainerId: containerId });
    setPanelVisible(targetPane.panel, true);
    setActivePaneId(targetPaneId);
    setLastPaneByPanel((prev) => ({ ...prev, [targetPane.panel]: targetPaneId }));
    if (container.kind === "editor") {
      setActiveEditorId(containerId);
      queueMicrotask(() => editorFocusMap.get(containerId)?.());
    }
  };

  const moveContainerToPanel = (containerId: string, targetPanel: PanelId) => {
    let targetPane =
      panesInPanel(targetPanel).find((p) => p.id === lastPaneByPanel()[targetPanel]) ??
      panesInPanel(targetPanel)[0];
    if (!targetPane) {
      targetPane = createPaneInPanel(targetPanel);
    }
    moveContainerToPane(containerId, targetPane.id);
  };

  const openEmptyTab = (targetPaneId?: string) => {
    const paneId =
      targetPaneId ??
      (focusedPanel() === "center" ? activePaneId() : lastPaneByPanel().center) ??
      panesInPanel("center")[0]?.id ??
      "pane-main-1";
    const panel = panelOfPane(paneId);
    const fresh = makeEmptyEditorContainer(paneId);
    setContainers((prev) => [...prev, fresh]);
    updatePane(paneId, { activeContainerId: fresh.id });
    setActiveEditorId(fresh.id);
    setPanelVisible(panel, true);
    setActivePaneId(paneId);
    setLastPaneByPanel((prev) => ({ ...prev, [panel]: paneId }));
    setFileLoadVersion((v) => v + 1);
    queueMicrotask(() => editorFocusMap.get(fresh.id)?.());
  };

  const splitPane = (sourcePaneId?: string) => {
    const basePane = getPane(sourcePaneId ?? activePaneId()) ?? panesInPanel("center")[0];
    if (!basePane) return;
    const newPane = createPaneInPanel(basePane.panel);
    const fresh = makeEmptyEditorContainer(newPane.id);
    setContainers((prev) => [...prev, fresh]);
    updatePane(newPane.id, { activeContainerId: fresh.id });
    setPanelVisible(basePane.panel, true);
    setActivePaneId(newPane.id);
    setLastPaneByPanel((prev) => ({ ...prev, [basePane.panel]: newPane.id }));
    setActiveEditorId(fresh.id);
    setFileLoadVersion((v) => v + 1);
    queueMicrotask(() => editorFocusMap.get(fresh.id)?.());
  };

  const closePane = async (paneId: string) => {
    const pane = getPane(paneId);
    if (!pane) return;
    const siblings = panesInPanel(pane.panel).filter((p) => p.id !== paneId);
    if (siblings.length === 0) return;
    const fallbackPane = siblings[0];

    const hosted = containersInPane(paneId);
    for (const c of hosted) {
      if (c.kind === "editor" && c.dirty && c.path) {
        await saveContainer(c, true);
      }
      if (c.kind !== "editor") {
        // Relocate tool containers (Explorer/Properties) safely to sibling pane
        updateContainer(c.id, { paneId: fallbackPane.id });
      }
    }

    const editorIdsToDrop = new Set(hosted.filter((c) => c.kind === "editor").map((c) => c.id));
    if (editorIdsToDrop.size > 0) {
      const remainingEditors = editorContainers().filter((c) => !editorIdsToDrop.has(c.id));
      if (remainingEditors.length === 0) {
        // Keep one empty editor in fallbackPane
        const fresh = makeEmptyEditorContainer(fallbackPane.id);
        setContainers((prev) => [
          ...prev.filter((c) => !editorIdsToDrop.has(c.id)),
          fresh,
        ]);
        updatePane(fallbackPane.id, { activeContainerId: fresh.id });
        setActiveEditorId(fresh.id);
      } else {
        setContainers((prev) => prev.filter((c) => !editorIdsToDrop.has(c.id)));
        if (editorIdsToDrop.has(activeEditorId())) {
          setActiveEditorId(remainingEditors[0].id);
        }
      }
    }

    setPanes((prev) => prev.filter((p) => p.id !== paneId));
    if (activePaneId() === paneId) {
      focusPane(fallbackPane.id);
    }
    setFileLoadVersion((v) => v + 1);
  };

  const closeTab = async (id?: string) => {
    const activeInFocused = activeContainerInPane(activePaneId());
    const targetId = id ?? (activeInFocused?.kind === "editor" ? activeInFocused.id : activeEditorId());
    const target = containers().find((c) => c.id === targetId);
    if (!target || target.kind !== "editor") return;

    if (target.dirty && target.path) {
      await saveContainer(target, true);
    }

    const allEditors = editorContainers();
    if (allEditors.length <= 1) {
      if (!target.path && (target.content ?? "") === "") {
        if (isTauriRuntime()) {
          await getCurrentWindow().close();
        }
        return;
      }
      updateContainer(target.id, { path: null, title: "Untitled", content: "", dirty: false });
      setFileLoadVersion((v) => v + 1);
      return;
    }

    const paneId = target.paneId;
    const panel = panelOfPane(paneId);
    const samePaneList = containersInPane(paneId);
    const idx = samePaneList.findIndex((c) => c.id === target.id);

    setContainers((prev) => prev.filter((c) => c.id !== target.id));

    const remaining = containersInPane(paneId);
    if (remaining.length > 0) {
      const next = remaining[Math.min(idx, remaining.length - 1)];
      updatePane(paneId, { activeContainerId: next.id });
      if (next.kind === "editor") setActiveEditorId(next.id);
    } else if (panesInPanel(panel).length > 1) {
      const sibling = panesInPanel(panel).find((p) => p.id !== paneId);
      setPanes((prev) => prev.filter((p) => p.id !== paneId));
      if (sibling && activePaneId() === paneId) {
        focusPane(sibling.id);
      }
    } else {
      updatePane(paneId, { activeContainerId: null });
    }

    if (activeEditorId() === target.id) {
      const fallback = editorContainers()[0];
      if (fallback) {
        setActiveEditorId(fallback.id);
        updatePane(fallback.paneId, { activeContainerId: fallback.id });
      }
    }
    setFileLoadVersion((v) => v + 1);
  };

  const cycleTabs = (delta: 1 | -1) => {
    const currentPane = getPane(activePaneId());
    let list = currentPane ? containersInPane(currentPane.id) : [];
    let targetPaneId = currentPane?.id ?? "pane-main-1";
    if (list.length <= 1) {
      const mainPaneId = lastPaneByPanel().center;
      const mainList = containersInPane(mainPaneId);
      if (mainList.length > 1) {
        list = mainList;
        targetPaneId = mainPaneId;
      }
    }
    if (list.length <= 1) return;
    const curId = getPane(targetPaneId)?.activeContainerId;
    const idx = Math.max(0, list.findIndex((c) => c.id === curId));
    const next = list[(idx + delta + list.length) % list.length];
    void selectContainer(next.id, true);
  };

  const nextTab = () => cycleTabs(1);
  const prevTab = () => cycleTabs(-1);

  const openFile = async (path: string, line?: number | null) => {
    const existing = editorContainers().find((c) => c.path === path);
    if (existing) {
      await selectContainer(existing.id, true);
      if (line && line > 0) setPendingJumpLine(line);
      return;
    }

    const current = activeEditorContainer();
    if (current?.dirty && current.path) {
      await saveContainer(current, true);
    }

    const text = await readNote(path);
    const reuseEmpty = current && !current.path && (current.content ?? "") === "";
    if (reuseEmpty && current) {
      updateContainer(current.id, {
        path,
        title: titleFromPath(path),
        content: text,
        dirty: false,
      });
      setActiveEditorId(current.id);
      updatePane(current.paneId, { activeContainerId: current.id });
      setFileLoadVersion((v) => v + 1);
    } else {
      const targetPaneId =
        current?.paneId ?? lastPaneByPanel().center ?? panesInPanel("center")[0]?.id ?? "pane-main-1";
      const newTab: ContainerTab = {
        id: `container-editor-${containerCounter++}`,
        kind: "editor",
        paneId: targetPaneId,
        path,
        title: titleFromPath(path),
        content: text,
        dirty: false,
      };
      setContainers((prev) => [...prev, newTab]);
      updatePane(targetPaneId, { activeContainerId: newTab.id });
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

  const onEditorContentChange = (next: string, containerId?: string) => {
    const id = containerId ?? activeEditorId();
    updateContainer(id, { content: next, dirty: true });
    const delay = config().editor.auto_save_ms;
    const tab = containers().find((c) => c.id === id);
    if (delay > 0 && tab?.path) {
      if (autoSaveTimer !== undefined) window.clearTimeout(autoSaveTimer);
      autoSaveTimer = window.setTimeout(() => {
        const latest = containers().find((c) => c.id === id);
        if (latest) void saveContainer(latest, true);
      }, delay);
    }
  };

  /** Optional container-specific focus command (unbound by default, bindable in Settings). */
  const focusKind = (kind: "explorer" | "properties") => {
    const container = containers().find((c) => c.kind === kind);
    if (!container) return;
    const panel = panelOfPane(container.paneId);
    const pane = getPane(container.paneId);
    if (
      isPanelVisible(panel) &&
      activePaneId() === container.paneId &&
      pane?.activeContainerId === container.id
    ) {
      focusMainPanel();
      return;
    }
    setPanelVisible(panel, true);
    updatePane(container.paneId, { activeContainerId: container.id });
    setActivePaneId(container.paneId);
    setLastPaneByPanel((prev) => ({ ...prev, [panel]: container.paneId }));
  };

  const createNewNote = async () => {
    if (!rootDir()) {
      const picked = await pickFolderDialog();
      if (!picked) return;
      await loadFolder(picked);
    }
    const exp = containers().find((c) => c.kind === "explorer");
    if (exp) {
      const panel = panelOfPane(exp.paneId);
      setPanelVisible(panel, true);
      updatePane(exp.paneId, { activeContainerId: exp.id });
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
      setContainers((prev) =>
        prev.map((c) =>
          c.path === oldPath ? { ...c, path: updated, title: titleFromPath(updated) } : c,
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
      const openTab = editorContainers().find((c) => c.path === path);
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

  const cycleRenderMode = async () => {
    const current = config();
    const order: RenderMode[] = ["rich", "minimal", "raw"];
    const idx = order.indexOf(current.editor.render_mode as RenderMode);
    const next = order[(idx + 1) % order.length];
    await updateConfig({
      ...current,
      editor: { ...current.editor, render_mode: next },
    });
    const labels: Record<RenderMode, string> = { rich: "Rich", minimal: "Minimal", raw: "Raw" };
    showToast(`Render: ${labels[next]}`);
  };

  const toggleEditorWidth = async () => {
    const current = config();
    const next = current.editor.editor_width === "full" ? "centered" : "full";
    await updateConfig({
      ...current,
      editor: { ...current.editor, editor_width: next },
    });
    showToast(next === "full" ? "Width: Full" : "Width: Centered");
  };

  const cycleLineNumberMode = async () => {
    const current = config();
    const order: LineNumberMode[] = ["relative", "absolute", "off"];
    const idx = order.indexOf(current.editor.line_number_mode as LineNumberMode);
    const next = order[(idx + 1) % order.length];
    await updateConfig({
      ...current,
      editor: { ...current.editor, line_number_mode: next },
    });
    const labels: Record<LineNumberMode, string> = {
      relative: "Relative",
      absolute: "Absolute",
      off: "Off",
    };
    showToast(`Lines: ${labels[next]}`);
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
      { id: "nib:new-tab", title: "New Tab", category: "Container", defaultKeybinding: "Mod-t", run: () => openEmptyTab() },
      { id: "nib:close-tab", title: "Close Tab", category: "Container", defaultKeybinding: "Mod-w", run: () => void closeTab() },
      { id: "nib:next-tab", title: "Next Container", category: "Container", defaultKeybinding: "Mod-Shift-]", run: () => nextTab() },
      { id: "nib:prev-tab", title: "Previous Container", category: "Container", defaultKeybinding: "Mod-Shift-[", run: () => prevTab() },
      { id: "nib:split-pane", title: "Split Pane", category: "Pane", run: () => splitPane() },
      { id: "nib:new-window", title: "New Window", category: "Window", defaultKeybinding: "Mod-Shift-n", run: () => void openAnotherWindow() },
      { id: "nib:open-folder", title: "Open Folder", category: "File", defaultKeybinding: "Mod-o", run: () => void openFolderPicker() },
      { id: "nib:toggle-left-panel", title: "Toggle Left Side Panel", category: "Panel", defaultKeybinding: "Mod-Shift-s", run: () => void togglePanel("left") },
      { id: "nib:toggle-right-panel", title: "Toggle Right Side Panel", category: "Panel", defaultKeybinding: "Mod-Shift-.", run: () => void togglePanel("right") },
      { id: "nib:toggle-bottom-panel", title: "Toggle Bottom Panel", category: "Panel", defaultKeybinding: "Mod-Shift-b", run: () => void togglePanel("bottom") },
      { id: "nib:focus-explorer", title: "Focus Explorer", category: "Container", run: () => focusKind("explorer") },
      { id: "nib:focus-properties", title: "Focus Properties", category: "Container", run: () => focusKind("properties") },
      { id: "nib:toggle-topbar", title: "Toggle Tab Bar", category: "View", run: () => void toggleTopbar() },
      { id: "nib:toggle-statusbar", title: "Toggle Status Bar", category: "View", run: () => void toggleStatusbar() },
      { id: "nib:toggle-vim", title: "Toggle Vim Mode", category: "Editor", defaultKeybinding: "Mod-Shift-v", run: () => void toggleVimMode() },
      { id: "nib:cycle-render-mode", title: "Cycle Render Mode", category: "Editor", defaultKeybinding: "Mod-Shift-m", run: () => void cycleRenderMode() },
      { id: "nib:toggle-editor-width", title: "Toggle Editor Width", category: "Editor", run: () => void toggleEditorWidth() },
      { id: "nib:cycle-line-numbers", title: "Cycle Line Numbers", category: "Editor", run: () => void cycleLineNumberMode() },
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
    containers,
    panesInPanel,
    containersInPane,
    activeContainerInPane,
    panelOfPane,
    editorContainers,
    activePaneId,
    activeEditorId,
    activeEditorContainer,
    activeFilePath,
    content,
    setContent,
    fileLoadVersion,
    dirty,
    setDirty,
    focusedPanel,
    focusPane,
    focusMainPanel,
    focusEditor: focusActiveEditor,
    draggingContainerId,
    setDraggingContainerId,
    leftVisible,
    setLeftVisible,
    rightVisible,
    setRightVisible,
    bottomVisible,
    setBottomVisible,
    isPanelVisible,
    setPanelVisible,
    togglePanel,
    togglePanelVisibility,
    mobileTabsOpen,
    setMobileTabsOpen,
    registerEditorFocus,
    unregisterEditorFocus,
    selectContainer,
    moveContainerToPane,
    moveContainerToPanel,
    openEmptyTab,
    splitPane,
    closePane,
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
    cycleRenderMode,
    toggleEditorWidth,
    cycleLineNumberMode,
    focusKind,
    toggleTopbar,
    toggleStatusbar,
    openSearch,
    openCommandPalette,
    openSettings,
  };
}

export type WindowStore = ReturnType<typeof createWindowStore>;
