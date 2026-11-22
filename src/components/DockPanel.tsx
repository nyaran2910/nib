import {
  Command,
  CopyPlus,
  Files,
  PanelLeft,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  X,
} from "lucide-solid";
import { For, Show, createMemo, createSignal } from "solid-js";
import type { DockZone, PaneTab, WindowStore } from "../state/store";
import { EditorView } from "./EditorView";
import { ExplorerPane } from "./ExplorerPane";
import { PropertiesPanel } from "./PropertiesPanel";

export function DockPanel(props: { store: WindowStore; zone: DockZone }) {
  const [dragOver, setDragOver] = createSignal(false);

  const tabs = createMemo(() => props.store.zonePanes(props.zone));
  const activeTab = createMemo<PaneTab | undefined>(() => {
    const list = tabs();
    const activeId = props.store.activeByZone()[props.zone];
    return list.find((t) => t.id === activeId) ?? list[0];
  });

  const isZoneFocused = () => props.store.focusedZone() === props.zone;
  const ui = () => props.store.config().ui;
  const showHeader = () => (props.zone === "center" ? ui().show_topbar : true);

  const handleDragOver = (e: DragEvent) => {
    if (!props.store.draggingTabId()) return;
    e.preventDefault();
    setDragOver(true);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const id = props.store.draggingTabId() ?? e.dataTransfer?.getData("text/nib-tab");
    if (id) {
      props.store.moveTabToZone(id, props.zone);
      props.store.setDraggingTabId(null);
    }
  };

  const renderNonEditorIcon = (kind: PaneTab["kind"]) => {
    if (kind === "explorer") return <Files size={15} />;
    return <SlidersHorizontal size={15} />;
  };

  return (
    <section
      class={`nib-dock nib-dock-${props.zone} ${isZoneFocused() ? "is-zone-focused" : ""} ${dragOver() ? "is-drag-over" : ""}`}
      style={
        props.zone === "left" || props.zone === "right"
          ? { width: `${props.store.config().appearance.sidebar_width}px` }
          : undefined
      }
      onDragOver={handleDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onMouseDown={() => props.store.setFocusedZone(props.zone)}
    >
      <Show when={showHeader()}>
        <header
          class={`nib-dock-header ${props.zone === "left" ? "is-left-chrome" : ""} ${props.zone === "center" && !props.store.isZoneVisible("left") ? "is-left-chrome" : ""}`}
          data-tauri-drag-region={props.zone === "left" || props.zone === "center" ? "" : undefined}
        >
          <Show when={props.zone === "center"}>
            <button
              class="nib-icon-btn"
              title="Toggle Left Panel"
              onClick={() => void props.store.toggleSidebar()}
            >
              <PanelLeft size={15} />
            </button>
          </Show>

          <div class="nib-tabs-strip" role="tablist">
            <For each={tabs()}>
              {(tab) => {
                const isActive = () => activeTab()?.id === tab.id;
                const isEditor = () => tab.kind === "editor";
                return (
                  <div
                    role="tab"
                    aria-selected={isActive()}
                    draggable={true}
                    onDragStart={(e) => {
                      props.store.setDraggingTabId(tab.id);
                      e.dataTransfer?.setData("text/nib-tab", tab.id);
                    }}
                    onDragEnd={() => props.store.setDraggingTabId(null)}
                    class={`nib-tab ${isEditor() ? "nib-tab-editor" : "nib-tab-icon-only"} ${isActive() ? "is-active" : ""}`}
                    onClick={() => void props.store.selectPane(tab.id, true)}
                    onMouseDown={(e) => {
                      if (e.button === 1 && isEditor()) {
                        e.preventDefault();
                        void props.store.closeTab(tab.id);
                      }
                    }}
                    title={tab.path ?? tab.title}
                  >
                    <Show
                      when={isEditor()}
                      fallback={renderNonEditorIcon(tab.kind)}
                    >
                      <span class="nib-tab-title">{tab.title}</span>
                      <Show when={tab.dirty}>
                        <span class="nib-dirty-dot" />
                      </Show>
                      <button
                        class="nib-tab-close"
                        title="Close"
                        onClick={(e) => {
                          e.stopPropagation();
                          void props.store.closeTab(tab.id);
                        }}
                      >
                        <X size={12} />
                      </button>
                    </Show>
                  </div>
                );
              }}
            </For>

            <Show when={props.zone === "center"}>
              <button
                class="nib-icon-btn nib-tab-new"
                title="New Tab"
                onClick={() => props.store.openEmptyTab("center")}
              >
                <Plus size={14} />
              </button>
            </Show>
          </div>
        </header>
      </Show>

      <div class="nib-dock-body">
        <Show when={activeTab()}>
          {(tab) => (
            <Show
              when={tab().kind === "editor"}
              fallback={
                <Show
                  when={tab().kind === "explorer"}
                  fallback={<PropertiesPanel store={props.store} zone={props.zone} />}
                >
                  <ExplorerPane store={props.store} zone={props.zone} />
                </Show>
              }
            >
              <EditorView store={props.store} tab={tab} />
            </Show>
          )}
        </Show>
      </div>

      {/* Obsidian-style bottom utility rail in left panel */}
      <Show when={props.zone === "left"}>
        <div class="nib-sidebar-footer">
          <div class="nib-sidebar-footer-group">
            <Show when={ui().show_topbar_search}>
              <button
                class="nib-icon-btn"
                title="Search"
                onClick={() => props.store.openSearch("omni")}
              >
                <Search size={15} />
              </button>
            </Show>
            <Show when={ui().show_topbar_command_palette}>
              <button
                class="nib-icon-btn"
                title="Command Palette"
                onClick={() => props.store.openCommandPalette()}
              >
                <Command size={15} />
              </button>
            </Show>
            <Show when={ui().show_topbar_new_window}>
              <button
                class="nib-icon-btn"
                title="New Window"
                onClick={() => void props.store.openAnotherWindow()}
              >
                <CopyPlus size={15} />
              </button>
            </Show>
          </div>

          <div class="nib-sidebar-footer-group">
            <Show when={ui().show_topbar_render_toggle}>
              <button
                class={`nib-icon-btn ${props.store.config().editor.render_markdown ? "is-accent" : ""}`}
                title="Markdown Render"
                onClick={() => void props.store.toggleRenderMarkdown()}
              >
                <Sparkles size={15} />
              </button>
            </Show>
            <Show when={ui().show_topbar_vim_toggle}>
              <button
                class={`nib-icon-btn ${props.store.config().editor.vim_mode ? "is-accent" : ""}`}
                title="Vim Mode"
                onClick={() => void props.store.toggleVimMode()}
              >
                <Terminal size={15} />
              </button>
            </Show>
            <Show when={ui().show_topbar_settings}>
              <button
                class="nib-icon-btn"
                title="Settings"
                onClick={() => props.store.openSettings()}
              >
                <Settings size={15} />
              </button>
            </Show>
          </div>
        </div>
      </Show>
    </section>
  );
}
