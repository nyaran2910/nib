import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { AppConfig, SessionRecord, SessionStoreData } from "../state/ipc";

export type Disposable = () => void;

export interface NibPluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  main: string;
}

export interface NibCommand {
  id: string;
  title: string;
  category?: string;
  defaultKeybinding?: string;
  run: (ctx: NibCommandContext) => void | Promise<void>;
}

export interface NibCommandContext {
  getEditorView: () => EditorView | null;
  getActiveFilePath: () => string | null;
}

export interface NibContainerMountContext {
  containerId: string;
  paneId: string;
  api: NibPluginAPI;
}

export interface NibContainerDefinition {
  kind: string;
  title: string;
  keywords?: string[];
  singleton?: boolean;
  mount: (el: HTMLElement, ctx: NibContainerMountContext) => void | Disposable;
}

export interface NibStatusBarItem {
  id: string;
  text: string;
  title?: string;
  align?: "left" | "right";
  onClick?: () => void;
}

export interface NibWorkspaceEventMap {
  "file:open": { path: string };
  "file:save": { path: string };
  "editor:change": { path: string | null; content: string };
  "layout:change": { activePaneId: string; focusedPanel: string };
  "session:switch": { sessionId: string; name: string };
  "session:save": { sessionId: string; name: string };
  "config:change": { config: AppConfig };
}

export type NibWorkspaceEventName = keyof NibWorkspaceEventMap;

export interface NibWorkspaceLayoutSnapshot {
  rootDir: string | null;
  activePaneId: string;
  focusedPanel: string;
  activeFilePath: string | null;
  panes: Array<{ id: string; panel: string; activeContainerId: string | null }>;
  containers: Array<{ id: string; kind: string; paneId: string; title: string; path?: string | null }>;
}

export interface NibHostBridge {
  getEditorView: () => EditorView | null;
  getContent: () => string;
  setContent: (next: string) => void;
  getRootDir: () => string | null;
  getActiveFilePath: () => string | null;
  openFile: (path: string, line?: number) => Promise<void>;
  getLayout: () => NibWorkspaceLayoutSnapshot;
  togglePanel: (panel: "left" | "right" | "bottom") => Promise<void>;
  splitPane: (paneId?: string) => void;
  openContainer: (kind: string, paneId?: string) => void;
  listSessions: () => Promise<SessionStoreData>;
  getCurrentSession: () => SessionRecord;
  saveSessionSnapshot: (name?: string) => Promise<SessionRecord>;
  restoreSession: (sessionId: string) => Promise<void>;
  createNamedSession: (name: string, fromCurrent?: boolean) => Promise<SessionRecord>;
  deleteSession: (sessionId: string) => Promise<void>;
  showToast: (message: string) => void;
  getConfig: () => AppConfig;
  updateConfig: (next: AppConfig) => Promise<void>;
}

/**
 * Obsidian / VS Code inspired public Plugin API exposed to extensions (and `window.nib`).
 */
export interface NibPluginAPI {
  readonly version: string;
  /** Backwards-compatible shorthands */
  registerCommand: (command: NibCommand) => Disposable;
  registerEditorExtension: (id: string, extension: Extension) => Disposable;

  commands: {
    register: (command: NibCommand) => Disposable;
    execute: (id: string) => Promise<boolean>;
    list: () => NibCommand[];
  };

  containers: {
    register: (definition: NibContainerDefinition) => Disposable;
    list: () => NibContainerDefinition[];
  };

  editor: {
    registerExtension: (id: string, extension: Extension) => Disposable;
    getActiveView: () => EditorView | null;
    getContent: () => string;
    setContent: (content: string) => void;
  };

  workspace: {
    getRootDir: () => string | null;
    getActiveFilePath: () => string | null;
    openFile: (path: string, line?: number) => Promise<void>;
    getLayout: () => NibWorkspaceLayoutSnapshot;
    togglePanel: (panel: "left" | "right" | "bottom") => Promise<void>;
    splitPane: (paneId?: string) => void;
    openContainer: (kind: string, paneId?: string) => void;
    on: <K extends NibWorkspaceEventName>(
      event: K,
      handler: (payload: NibWorkspaceEventMap[K]) => void,
    ) => Disposable;
  };

  sessions: {
    list: () => Promise<SessionStoreData>;
    getCurrent: () => SessionRecord | null;
    saveSnapshot: (name?: string) => Promise<SessionRecord | null>;
    restore: (sessionId: string) => Promise<void>;
    createNamed: (name: string, fromCurrent?: boolean) => Promise<SessionRecord | null>;
    delete: (sessionId: string) => Promise<void>;
  };

  ui: {
    showToast: (message: string) => void;
    registerStatusBarItem: (item: NibStatusBarItem) => Disposable;
  };

  config: {
    get: () => AppConfig | null;
    update: (next: AppConfig) => Promise<void>;
  };
}

export interface NibPlugin {
  manifest: NibPluginManifest;
  activate: (api: NibPluginAPI) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
}

declare global {
  interface Window {
    nib?: {
      api: NibPluginAPI;
      registerPlugin: (plugin: NibPlugin) => Promise<void>;
      unregisterPlugin: (pluginId: string) => Promise<void>;
    };
  }
}
