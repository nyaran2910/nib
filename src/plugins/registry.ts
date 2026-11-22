import type { Extension } from "@codemirror/state";
import type { NibCommand, NibCommandContext, NibPlugin, NibPluginAPI } from "./types";

/**
 * Unified Obsidian-style Command & Plugin Registry.
 * Every built-in action AND future JS/TS plugin (`manifest.json` + `main.js`) registers
 * commands here so they can be executed from the Command Palette OR bound to custom hotkeys.
 */
export class PluginRegistry {
  private plugins = new Map<string, NibPlugin>();
  private commands = new Map<string, NibCommand>();
  private editorExtensions = new Map<string, Extension>();
  private listeners = new Set<() => void>();

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  registerCommand(command: NibCommand): () => void {
    this.commands.set(command.id, command);
    this.notify();
    return () => {
      this.commands.delete(command.id);
      this.notify();
    };
  }

  async registerPlugin(plugin: NibPlugin): Promise<void> {
    if (this.plugins.has(plugin.manifest.id)) {
      await this.unregisterPlugin(plugin.manifest.id);
    }

    const api: NibPluginAPI = {
      registerCommand: (command) => this.registerCommand(command),
      registerEditorExtension: (id, extension) => {
        const key = `${plugin.manifest.id}:${id}`;
        this.editorExtensions.set(key, extension);
        this.notify();
        return () => {
          this.editorExtensions.delete(key);
          this.notify();
        };
      },
    };

    this.plugins.set(plugin.manifest.id, plugin);
    await plugin.activate(api);
  }

  async unregisterPlugin(pluginId: string): Promise<void> {
    const existing = this.plugins.get(pluginId);
    if (!existing) return;
    await existing.deactivate?.();
    this.plugins.delete(pluginId);
    for (const key of Array.from(this.editorExtensions.keys())) {
      if (key.startsWith(`${pluginId}:`)) {
        this.editorExtensions.delete(key);
      }
    }
    this.notify();
  }

  getEditorExtensions(): Extension[] {
    return Array.from(this.editorExtensions.values());
  }

  getCommands(): NibCommand[] {
    return Array.from(this.commands.values());
  }

  async runCommand(id: string, ctx: NibCommandContext): Promise<boolean> {
    const cmd = this.commands.get(id);
    if (!cmd) return false;
    await cmd.run(ctx);
    return true;
  }
}

export const pluginRegistry = new PluginRegistry();
