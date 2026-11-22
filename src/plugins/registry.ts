import type { Extension } from "@codemirror/state";
import type {
  Disposable,
  NibCommand,
  NibCommandContext,
  NibContainerDefinition,
  NibHostBridge,
  NibPlugin,
  NibPluginAPI,
  NibStatusBarItem,
  NibWorkspaceEventMap,
  NibWorkspaceEventName,
} from "./types";

/**
 * Unified Obsidian / VS Code inspired Extension & Command Registry.
 * Built-in features and user plugins share the same Command, Container, Editor Extension,
 * StatusBar, Session, and Workspace Event APIs (`window.nib`).
 */
export class PluginRegistry {
  private plugins = new Map<string, { plugin: NibPlugin; disposables: Disposable[] }>();
  private commands = new Map<string, NibCommand>();
  private editorExtensions = new Map<string, Extension>();
  private containers = new Map<string, NibContainerDefinition>();
  private statusBarItems = new Map<string, NibStatusBarItem>();
  private eventHandlers = new Map<NibWorkspaceEventName, Set<(payload: never) => void>>();
  private listeners = new Set<() => void>();
  private host: NibHostBridge | null = null;

  onChange(listener: () => void): Disposable {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  attachHost(host: NibHostBridge): Disposable {
    this.host = host;
    const api = this.createAPI("window.nib");
    if (typeof window !== "undefined") {
      window.nib = {
        api,
        registerPlugin: (plugin) => this.registerPlugin(plugin),
        unregisterPlugin: (pluginId) => this.unregisterPlugin(pluginId),
      };
    }
    return () => {
      if (this.host === host) this.host = null;
    };
  }

  emit<K extends NibWorkspaceEventName>(event: K, payload: NibWorkspaceEventMap[K]): void {
    const set = this.eventHandlers.get(event);
    if (!set) return;
    for (const fn of set) {
      try {
        (fn as (p: NibWorkspaceEventMap[K]) => void)(payload);
      } catch {
        // Isolate plugin listener errors from core app
      }
    }
  }

  on<K extends NibWorkspaceEventName>(
    event: K,
    handler: (payload: NibWorkspaceEventMap[K]) => void,
  ): Disposable {
    let set = this.eventHandlers.get(event);
    if (!set) {
      set = new Set();
      this.eventHandlers.set(event, set);
    }
    set.add(handler as (payload: never) => void);
    return () => {
      set?.delete(handler as (payload: never) => void);
    };
  }

  registerCommand(command: NibCommand): Disposable {
    this.commands.set(command.id, command);
    this.notify();
    return () => {
      this.commands.delete(command.id);
      this.notify();
    };
  }

  registerEditorExtension(key: string, extension: Extension): Disposable {
    this.editorExtensions.set(key, extension);
    this.notify();
    return () => {
      this.editorExtensions.delete(key);
      this.notify();
    };
  }

  registerContainer(definition: NibContainerDefinition): Disposable {
    this.containers.set(definition.kind, definition);
    this.notify();
    return () => {
      this.containers.delete(definition.kind);
      this.notify();
    };
  }

  registerStatusBarItem(item: NibStatusBarItem): Disposable {
    this.statusBarItems.set(item.id, item);
    this.notify();
    return () => {
      this.statusBarItems.delete(item.id);
      this.notify();
    };
  }

  createAPI(scopeId: string, track?: (d: Disposable) => Disposable): NibPluginAPI {
    const wrap = track ?? ((d: Disposable) => d);

    const registerCmd = (command: NibCommand) => wrap(this.registerCommand(command));
    const registerExt = (id: string, ext: Extension) =>
      wrap(this.registerEditorExtension(`${scopeId}:${id}`, ext));

    return {
      version: "0.1.0",
      registerCommand: registerCmd,
      registerEditorExtension: registerExt,

      commands: {
        register: registerCmd,
        execute: (id) =>
          this.runCommand(id, {
            getEditorView: () => this.host?.getEditorView() ?? null,
            getActiveFilePath: () => this.host?.getActiveFilePath() ?? null,
          }),
        list: () => this.getCommands(),
      },

      containers: {
        register: (definition) => wrap(this.registerContainer(definition)),
        list: () => this.getContainers(),
      },

      editor: {
        registerExtension: registerExt,
        getActiveView: () => this.host?.getEditorView() ?? null,
        getContent: () => this.host?.getContent() ?? "",
        setContent: (content) => this.host?.setContent(content),
      },

      workspace: {
        getRootDir: () => this.host?.getRootDir() ?? null,
        getActiveFilePath: () => this.host?.getActiveFilePath() ?? null,
        openFile: async (path, line) => {
          await this.host?.openFile(path, line);
        },
        getLayout: () =>
          this.host?.getLayout() ?? {
            rootDir: null,
            activePaneId: "",
            focusedPanel: "center",
            activeFilePath: null,
            panes: [],
            containers: [],
          },
        togglePanel: async (panel) => {
          await this.host?.togglePanel(panel);
        },
        splitPane: (paneId) => this.host?.splitPane(paneId),
        openContainer: (kind, paneId) => this.host?.openContainer(kind, paneId),
        on: (event, handler) => wrap(this.on(event, handler)),
      },

      sessions: {
        list: async () =>
          (await this.host?.listSessions()) ?? { last_session_id: null, named: [], history: [] },
        getCurrent: () => this.host?.getCurrentSession() ?? null,
        saveSnapshot: async (name) => (await this.host?.saveSessionSnapshot(name)) ?? null,
        restore: async (sessionId) => {
          await this.host?.restoreSession(sessionId);
        },
        createNamed: async (name, fromCurrent = true) =>
          (await this.host?.createNamedSession(name, fromCurrent)) ?? null,
        delete: async (sessionId) => {
          await this.host?.deleteSession(sessionId);
        },
      },

      ui: {
        showToast: (message) => this.host?.showToast(message),
        registerStatusBarItem: (item) =>
          wrap(this.registerStatusBarItem({ ...item, id: `${scopeId}:${item.id}` })),
      },

      config: {
        get: () => this.host?.getConfig() ?? null,
        update: async (next) => {
          await this.host?.updateConfig(next);
        },
      },
    };
  }

  async registerPlugin(plugin: NibPlugin): Promise<void> {
    if (this.plugins.has(plugin.manifest.id)) {
      await this.unregisterPlugin(plugin.manifest.id);
    }

    const disposables: Disposable[] = [];
    const track = (d: Disposable): Disposable => {
      disposables.push(d);
      return d;
    };

    const api = this.createAPI(plugin.manifest.id, track);
    this.plugins.set(plugin.manifest.id, { plugin, disposables });
    await plugin.activate(api);
  }

  async unregisterPlugin(pluginId: string): Promise<void> {
    const entry = this.plugins.get(pluginId);
    if (!entry) return;
    await entry.plugin.deactivate?.();
    for (const dispose of entry.disposables) {
      dispose();
    }
    this.plugins.delete(pluginId);
    this.notify();
  }

  getEditorExtensions(): Extension[] {
    return Array.from(this.editorExtensions.values());
  }

  getCommands(): NibCommand[] {
    return Array.from(this.commands.values());
  }

  getContainers(): NibContainerDefinition[] {
    return Array.from(this.containers.values());
  }

  getContainer(kind: string): NibContainerDefinition | undefined {
    return this.containers.get(kind);
  }

  getStatusBarItems(): NibStatusBarItem[] {
    return Array.from(this.statusBarItems.values());
  }

  async runCommand(id: string, ctx: NibCommandContext): Promise<boolean> {
    const cmd = this.commands.get(id);
    if (!cmd) return false;
    await cmd.run(ctx);
    return true;
  }
}

export const pluginRegistry = new PluginRegistry();
