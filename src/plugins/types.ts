import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

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

export interface NibPluginAPI {
  registerCommand: (command: NibCommand) => () => void;
  registerEditorExtension: (id: string, extension: Extension) => () => void;
}

export interface NibPlugin {
  manifest: NibPluginManifest;
  activate: (api: NibPluginAPI) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
}
