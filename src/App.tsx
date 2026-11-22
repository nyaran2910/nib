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
import { createWindowStore, type DockZone } from "./state/store";

function matchesKeybinding(e: KeyboardEvent, binding: string): boolean {
  const parts = binding.split("-").map((p) => p.trim().toLowerCase());
  const key = parts[parts.length - 1];
  const needMod = parts.includes("mod");
  const needCtrl = parts.includes("ctrl");
  const needShift = parts.includes("shift");
  const needAlt = parts.includes("alt");

  const isMac = navigator.platform.toUpperCase().includes("MAC");
  const hasMod = isMac ? e.metaKey : e.ctrlKey;
  const hasCtrl = isMac ? e.ctrlKey : e.ctrlKey && !needMod;

  if (needMod && needCtrl) {
    return (
      e.metaKey &&
      e.ctrlKey &&
      e.shiftKey === needShift &&
      e.altKey === needAlt &&
      e.key.toLowerCase() === key
    );
  }
  return (
    hasMod === needMod &&
    hasCtrl === needCtrl &&
    e.shiftKey === needShift &&
    e.altKey === needAlt &&
    e.key.toLowerCase() === key
  );
}

export function App() {
  const store = createWindowStore();

  onMount(async () => {
    const disposeCommands = store.registerBuiltinCommands();
    await store.bootstrap();

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Built-in Ctrl+Tab / Ctrl+Shift+Tab tab cycling (macOS / browser / VS Code style)
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
      listenEvent("menu:toggle-sidebar", () => void store.toggleSidebar()),
      listenEvent("menu:toggle-vim", () => void store.toggleVimMode()),
      listenEvent("menu:toggle-render", () => void store.toggleRenderMarkdown()),
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

  const makeDropEdge = (zone: DockZone, label: string) => (
    <div
      class={`nib-drop-edge nib-drop-edge-${zone}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const id = store.draggingTabId() ?? e.dataTransfer?.getData("text/nib-tab");
        if (id) {
          store.moveTabToZone(id, zone);
          store.setDraggingTabId(null);
        }
      }}
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
          onClick={() => void store.toggleSidebar()}
        >
          <Menu size={20} />
        </button>
        <div class="nib-ios-nav-title">
          <span>{store.activeEditorTab()?.title ?? "Untitled"}</span>
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
        {/* Left Dock Panel (Drawer on Mobile) */}
        <Show when={store.isZoneVisible("left")}>
          <div
            class="nib-mobile-drawer-backdrop"
            onClick={() => store.setLeftVisible(false)}
          />
          <DockPanel store={store} zone="left" />
        </Show>

        {/* Center + Bottom Column */}
        <div class="nib-center-col">
          <div class="nib-center-main">
            <DockPanel store={store} zone="center" />
          </div>

          <Show when={store.isZoneVisible("bottom")}>
            <DockPanel store={store} zone="bottom" />
          </Show>

          <Show when={store.config().ui.show_statusbar}>
            <StatusBar store={store} />
          </Show>
        </div>

        {/* Right Dock Panel */}
        <Show when={store.isZoneVisible("right")}>
          <DockPanel store={store} zone="right" />
        </Show>

        {/* Drag-to-dock edges when dragging any tab */}
        <Show when={store.draggingTabId()}>
          <Show when={!store.isZoneVisible("left")}>{makeDropEdge("left", "Left")}</Show>
          <Show when={!store.isZoneVisible("right")}>{makeDropEdge("right", "Right")}</Show>
          <Show when={!store.isZoneVisible("bottom")}>{makeDropEdge("bottom", "Bottom")}</Show>
        </Show>
      </div>

      {/* Obsidian iOS / SwiftUI Frosted Bottom Navigation Bar */}
      <nav class="nib-ios-tabbar" aria-label="Mobile Navigation">
        <button class="nib-ios-tab-btn" onClick={() => void store.toggleSidebar()}>
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
          <span class="nib-ios-tab-count">{store.editorTabs().length}</span>
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
                    store.openEmptyTab("center");
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
              <For each={store.editorTabs()}>
                {(tab) => (
                  <div
                    class={`nib-ios-tab-card ${tab.id === store.activeEditorId() ? "is-active" : ""}`}
                    onClick={() => {
                      void store.selectPane(tab.id, true);
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
