import {
  Command,
  FilePlus,
  Files,
  Menu,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  X,
} from "lucide-solid";
import { For, Show, onCleanup, onMount } from "solid-js";
import { CommandPalette } from "./components/CommandPalette";
import { DockPanel } from "./components/DockPanel";
import { SearchModal } from "./components/SearchModal";
import { SettingsModal } from "./components/SettingsModal";
import { StatusBar } from "./components/StatusBar";
import { pluginRegistry } from "./plugins/registry";
import { getConfig, listenEvent, unwatchDirectory, type AppConfig } from "./state/ipc";
import { createWindowStore, type PanelId } from "./state/store";

const PUNCT_CODE_MAP: Record<string, { code: string; shifted?: string }> = {
  ".": { code: "Period", shifted: ">" },
  ",": { code: "Comma", shifted: "<" },
  "[": { code: "BracketLeft", shifted: "{" },
  "]": { code: "BracketRight", shifted: "}" },
  "/": { code: "Slash", shifted: "?" },
  ";": { code: "Semicolon", shifted: ":" },
  "'": { code: "Quote", shifted: '"' },
  "-": { code: "Minus", shifted: "_" },
  "=": { code: "Equal", shifted: "+" },
  "\\": { code: "Backslash", shifted: "|" },
};

const SPECIAL_CODE_MAP: Record<string, string> = {
  left: "ArrowLeft",
  arrowleft: "ArrowLeft",
  right: "ArrowRight",
  arrowright: "ArrowRight",
  up: "ArrowUp",
  arrowup: "ArrowUp",
  down: "ArrowDown",
  arrowdown: "ArrowDown",
};

function matchesKeyToken(e: KeyboardEvent, key: string): boolean {
  if (e.key.toLowerCase() === key) return true;
  const special = SPECIAL_CODE_MAP[key];
  if (special) return e.code === special || e.key === special;
  const punct = PUNCT_CODE_MAP[key];
  if (punct) {
    return e.code === punct.code || (punct.shifted !== undefined && e.key === punct.shifted);
  }
  if (key.length === 1 && key >= "a" && key <= "z") {
    return e.code === `Key${key.toUpperCase()}`;
  }
  if (key.length === 1 && key >= "0" && key <= "9") {
    return e.code === `Digit${key}`;
  }
  return false;
}

function matchesKeybinding(e: KeyboardEvent, binding: string): boolean {
  const trimmed = binding.trim();
  if (!trimmed) return false;
  const parts = trimmed.split("-").map((p) => p.trim().toLowerCase());
  const key = parts[parts.length - 1];
  if (!key) return false;
  const mods = parts.slice(0, -1);
  const needMod = mods.includes("mod");
  const needCtrl = mods.includes("ctrl");
  const needShift = mods.includes("shift");
  const needAlt = mods.includes("alt");

  const isMac = navigator.platform.toUpperCase().includes("MAC");
  const hasMod = isMac ? e.metaKey : e.ctrlKey;
  const hasCtrl = isMac ? e.ctrlKey : e.ctrlKey && !needMod;

  if (needMod && needCtrl) {
    return (
      e.metaKey &&
      e.ctrlKey &&
      e.shiftKey === needShift &&
      e.altKey === needAlt &&
      matchesKeyToken(e, key)
    );
  }
  return (
    hasMod === needMod &&
    hasCtrl === needCtrl &&
    e.shiftKey === needShift &&
    e.altKey === needAlt &&
    matchesKeyToken(e, key)
  );
}

export function App() {
  const store = createWindowStore();

  onMount(async () => {
    const disposeCommands = store.registerBuiltinCommands();
    await store.bootstrap();

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Built-in Ctrl+Tab / Ctrl+Shift+Tab container cycling inside active Pane
      if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === "Tab") {
        if (store.settingsOpen() || store.searchModalOpen() || store.commandPaletteOpen()) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) store.prevTab();
        else store.nextTab();
        return;
      }

      if (!e.metaKey && !e.ctrlKey) return;
      if (store.settingsOpen()) return;

      const bindings = store.config().keybindings;
      for (const [cmdId, shortcut] of Object.entries(bindings)) {
        if (shortcut && matchesKeybinding(e, shortcut)) {
          e.preventDefault();
          e.stopPropagation();
          void pluginRegistry.runCommand(cmdId, {
            getEditorView: () => null,
            getActiveFilePath: () => store.activeFilePath(),
          });
          return;
        }
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown, true);

    let fsRefreshTimer: number | undefined;

    const unlisteners = await Promise.all([
      listenEvent<AppConfig>("config:updated", async () => {
        const effective = await getConfig(store.rootDir());
        if (JSON.stringify(effective) !== JSON.stringify(store.config())) {
          store.setConfig(effective);
          store.applyThemeTokens(effective);
        }
      }),
      listenEvent<{ root: string }>("fs:changed", (payload) => {
        if (payload.root === store.rootDir()) {
          if (fsRefreshTimer !== undefined) window.clearTimeout(fsRefreshTimer);
          fsRefreshTimer = window.setTimeout(() => {
            void store.refreshTree();
          }, 250);
        }
      }),
      listenEvent("menu:new-note", () => void store.createNewNote()),
      listenEvent("menu:open-folder", () => void store.openFolderPicker()),
      listenEvent("menu:save", () => void store.saveActiveFile()),
      listenEvent("menu:settings", () => store.openSettings()),
      listenEvent("menu:command-palette", () => store.openCommandPalette()),
      listenEvent("menu:search-omni", () => store.openSearch("omni")),
      listenEvent("menu:search-files", () => store.openSearch("files")),
      listenEvent("menu:search-content", () => store.openSearch("content")),
      listenEvent("menu:search-tags", () => store.openSearch("tags")),
      listenEvent("menu:toggle-sidebar", () => void store.togglePanel("left")),
      listenEvent("menu:toggle-vim", () => void store.toggleVimMode()),
      listenEvent("menu:toggle-render", () => void store.cycleRenderMode()),
    ]);

    onCleanup(() => {
      window.removeEventListener("keydown", handleGlobalKeyDown, true);
      if (fsRefreshTimer !== undefined) window.clearTimeout(fsRefreshTimer);
      const dir = store.rootDir();
      if (dir) void unwatchDirectory(dir);
      disposeCommands();
      for (const unlisten of unlisteners) {
        unlisten();
      }
    });
  });

  const makeDropEdge = (panel: PanelId, label: string) => (
    <div
      data-drop-panel={panel}
      class={`nib-drop-edge nib-drop-edge-${panel} ${store.dragState()?.hoverPanel === panel ? "is-hover" : ""}`}
    >
      {label}
    </div>
  );

  return (
    <div class="nib-shell">
      {/* SwiftUI / Obsidian iOS Frosted Mobile Navigation Bar */}
      <header class="nib-ios-navbar">
        <button
          class="nib-ios-nav-btn"
          aria-label="Sidebar"
          onClick={() => void store.togglePanelVisibility("left")}
        >
          <Menu size={20} />
        </button>
        <div class="nib-ios-nav-title">
          <span>{store.activeEditorContainer()?.title ?? "Untitled"}</span>
          <Show when={store.dirty()}>
            <span class="nib-dirty-dot" />
          </Show>
        </div>
        <div class="nib-ios-nav-actions">
          <button
            class="nib-ios-nav-btn"
            aria-label="Search"
            onClick={() => store.openSearch("omni")}
          >
            <Search size={19} />
          </button>
          <button
            class="nib-ios-nav-btn"
            aria-label="Settings"
            onClick={() => store.openSettings()}
          >
            <MoreHorizontal size={20} />
          </button>
        </div>
      </header>

      <div class="nib-dock-layout">
        {/* Left Side Panel (Drawer on Mobile) */}
        <Show when={store.isPanelVisible("left")}>
          <div
            class="nib-mobile-drawer-backdrop"
            onClick={() => store.setLeftVisible(false)}
          />
          <DockPanel store={store} panel="left" />
        </Show>

        {/* Main Panel + Bottom Panel Column */}
        <div class="nib-center-col">
          <div class="nib-center-main">
            <DockPanel store={store} panel="center" />
          </div>

          <Show when={store.isPanelVisible("bottom")}>
            <DockPanel store={store} panel="bottom" />
          </Show>

          <Show when={store.config().ui.show_statusbar}>
            <StatusBar store={store} />
          </Show>
        </div>

        {/* Right Side Panel */}
        <Show when={store.isPanelVisible("right")}>
          <DockPanel store={store} panel="right" />
        </Show>

        {/* Drag-to-dock edges when dragging any Container tab */}
        <Show when={store.dragState()}>
          <Show when={!store.isPanelVisible("left")}>{makeDropEdge("left", "Left")}</Show>
          <Show when={!store.isPanelVisible("right")}>{makeDropEdge("right", "Right")}</Show>
          <Show when={!store.isPanelVisible("bottom")}>{makeDropEdge("bottom", "Bottom")}</Show>
        </Show>
      </div>

      {/* Floating drag ghost pill */}
      <Show when={store.dragState()}>
        {(drag) => (
          <div
            class="nib-drag-ghost"
            style={{
              left: `${drag().x + 12}px`,
              top: `${drag().y + 12}px`,
            }}
          >
            {drag().title}
          </div>
        )}
      </Show>

      {/* Obsidian iOS / SwiftUI Frosted Bottom Navigation Bar */}
      <nav class="nib-ios-tabbar" aria-label="Mobile Navigation">
        <button class="nib-ios-tab-btn" onClick={() => void store.togglePanelVisibility("left")}>
          <Files size={20} />
        </button>
        <button class="nib-ios-tab-btn" onClick={() => store.openSearch("omni")}>
          <Search size={20} />
        </button>
        <button class="nib-ios-tab-btn nib-ios-tab-primary" onClick={() => void store.createNewNote()}>
          <FilePlus size={20} />
        </button>
        <button
          class="nib-ios-tab-btn"
          aria-label="Tabs"
          onClick={() => store.setMobileTabsOpen(true)}
        >
          <span class="nib-ios-tab-count">{store.editorContainers().length}</span>
        </button>
        <button class="nib-ios-tab-btn" onClick={() => store.openCommandPalette()}>
          <Command size={20} />
        </button>
      </nav>

      {/* iOS SwiftUI-style Tab Overview Sheet */}
      <Show when={store.mobileTabsOpen()}>
        <div
          class="nib-modal-backdrop nib-ios-sheet-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) store.setMobileTabsOpen(false);
          }}
        >
          <div class="nib-ios-sheet" role="dialog" aria-label="Tabs">
            <div class="nib-ios-sheet-handle" />
            <div class="nib-ios-sheet-header">
              <span>Tabs</span>
              <div style={{ display: "flex", gap: "6px" }}>
                <button
                  class="nib-icon-btn"
                  onClick={() => {
                    store.openEmptyTab();
                    store.setMobileTabsOpen(false);
                  }}
                >
                  <Plus size={18} />
                </button>
                <button class="nib-icon-btn" onClick={() => store.openSettings()}>
                  <Settings size={17} />
                </button>
                <button class="nib-icon-btn" onClick={() => store.setMobileTabsOpen(false)}>
                  <X size={18} />
                </button>
              </div>
            </div>
            <div class="nib-ios-sheet-grid">
              <For each={store.editorContainers()}>
                {(tab) => (
                  <div
                    class={`nib-ios-tab-card ${tab.id === store.activeEditorId() ? "is-active" : ""}`}
                    onClick={() => {
                      void store.selectContainer(tab.id, true);
                      store.setMobileTabsOpen(false);
                    }}
                  >
                    <div class="nib-ios-tab-card-top">
                      <span class="nib-ios-tab-card-title">{tab.title}</span>
                      <button
                        class="nib-icon-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          void store.closeTab(tab.id);
                        }}
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <div class="nib-ios-tab-card-preview">
                      {(tab.content ?? "").slice(0, 120)}
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
      </Show>

      <Show when={store.toast()}>
        <div class="nib-toast" role="status">
          {store.toast()}
        </div>
      </Show>

      <SearchModal store={store} />
      <CommandPalette store={store} />
      <SettingsModal store={store} />
    </div>
  );
}
