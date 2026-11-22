import {
  Columns2,
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
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import type { ContainerTab, PanelId, WindowStore } from "../state/store";
import { EditorView } from "./EditorView";
import { ExplorerPane } from "./ExplorerPane";
import { PropertiesPanel } from "./PropertiesPanel";

function PaneView(props: {
  store: WindowStore;
  paneId: string;
  paneIndex: () => number;
  totalPanes: () => number;
}) {
  let emptyPaneRef: HTMLDivElement | undefined;
  const [dragOver, setDragOver] = createSignal(false);

  const panel = createMemo(() => props.store.panelOfPane(props.paneId));
  const tabIds = createMemo(() =>
    props.store.containersInPane(props.paneId).map((c) => c.id),
  );
  const getTab = (id: string) => props.store.containers().find((c) => c.id === id);
  const activeTab = createMemo<ContainerTab | undefined>(() =>
    props.store.activeContainerInPane(props.paneId),
  );
  const isPaneFocused = () => props.store.activePaneId() === props.paneId;
  const ui = () => props.store.config().ui;
  const showHeader = () => (panel() === "center" ? ui().show_topbar : true);
  const needsTrafficLightPad = () =>
    props.paneIndex() === 0 &&
    (panel() === "left" || (panel() === "center" && !props.store.isPanelVisible("left")));

  createEffect(() => {
    if (isPaneFocused() && !activeTab() && document.activeElement !== emptyPaneRef) {
      queueMicrotask(() => emptyPaneRef?.focus());
    }
  });

  const handleDragOver = (e: DragEvent) => {
    if (!props.store.draggingContainerId()) return;
    e.preventDefault();
    setDragOver(true);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const id = props.store.draggingContainerId() ?? e.dataTransfer?.getData("text/nib-tab");
    if (id) {
      props.store.moveContainerToPane(id, props.paneId);
      props.store.setDraggingContainerId(null);
    }
  };

  const renderNonEditorIcon = (kind: ContainerTab["kind"]) => {
    if (kind === "explorer") return <Files size={15} />;
    return <SlidersHorizontal size={15} />;
  };

  return (
    <div
      class={`nib-pane ${isPaneFocused() ? "is-pane-focused" : ""} ${dragOver() ? "is-drag-over" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onMouseDown={() => {
        if (props.store.activePaneId() !== props.paneId) {
          props.store.focusPane(props.paneId, false);
        }
      }}
    >
      <Show when={showHeader()}>
        <header
          class={`nib-dock-header ${needsTrafficLightPad() ? "is-left-chrome" : ""}`}
          data-tauri-drag-region={
            props.paneIndex() === 0 && (panel() === "left" || panel() === "center")
              ? ""
              : undefined
          }
        >
          <Show when={panel() === "center" && props.paneIndex() === 0}>
            <button
              class="nib-icon-btn"
              title="Toggle Left Side Panel"
              onClick={(e) => {
                e.stopPropagation();
                void props.store.togglePanelVisibility("left");
              }}
            >
              <PanelLeft size={15} />
            </button>
          </Show>

          <div class="nib-tabs-strip" role="tablist">
            <For each={tabIds()}>
              {(tabId) => {
                const tab = () => getTab(tabId);
                const isActive = () => activeTab()?.id === tabId;
                const isEditor = () => tab()?.kind === "editor";
                return (
                  <Show when={tab()}>
                    {(t) => (
                      <div
                        role="tab"
                        aria-selected={isActive()}
                        draggable={true}
                        onDragStart={(e) => {
                          props.store.setDraggingContainerId(tabId);
                          e.dataTransfer?.setData("text/nib-tab", tabId);
                        }}
                        onDragEnd={() => props.store.setDraggingContainerId(null)}
                        class={`nib-tab ${isEditor() ? "nib-tab-editor" : "nib-tab-icon-only"} ${isActive() ? "is-active" : ""}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void props.store.selectContainer(tabId, true);
                        }}
                        onMouseDown={(e) => {
                          if (e.button === 1 && isEditor()) {
                            e.preventDefault();
                            e.stopPropagation();
                            void props.store.closeTab(tabId);
                          }
                        }}
                        title={t().path ?? t().title}
                      >
                        <Show when={isEditor()} fallback={renderNonEditorIcon(t().kind)}>
                          <span class="nib-tab-title">{t().title}</span>
                          <Show when={t().dirty}>
                            <span class="nib-dirty-dot" />
                          </Show>
                          <button
                            class="nib-tab-close"
                            title="Close"
                            onClick={(e) => {
                              e.stopPropagation();
                              void props.store.closeTab(tabId);
                            }}
                          >
                            <X size={12} />
                          </button>
                        </Show>
                      </div>
                    )}
                  </Show>
                );
              }}
            </For>

            <Show when={panel() === "center" || tabIds().length === 0}>
              <button
                class="nib-icon-btn nib-tab-new"
                title="New Tab"
                onClick={(e) => {
                  e.stopPropagation();
                  props.store.openEmptyTab(props.paneId);
                }}
              >
                <Plus size={14} />
              </button>
            </Show>
          </div>

          <div class="nib-pane-actions">
            <button
              class="nib-icon-btn"
              title="Split Pane"
              onClick={(e) => {
                e.stopPropagation();
                props.store.splitPane(props.paneId);
              }}
            >
              <Columns2 size={14} />
            </button>
            <Show when={props.totalPanes() > 1}>
              <button
                class="nib-icon-btn"
                title="Close Pane"
                onClick={(e) => {
                  e.stopPropagation();
                  void props.store.closePane(props.paneId);
                }}
              >
                <X size={14} />
              </button>
            </Show>
          </div>
        </header>
      </Show>

      <div class="nib-dock-body">
        <Show
          when={activeTab()}
          fallback={
            <div
              ref={emptyPaneRef}
              class="nib-empty-pane"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  props.store.focusMainPanel();
                }
              }}
            >
              <button
                class="nib-secondary-btn"
                onClick={() => props.store.openEmptyTab(props.paneId)}
              >
                New Tab
              </button>
            </div>
          }
        >
          {(tab) => (
            <Show
              when={tab().kind === "editor"}
              fallback={
                <Show
                  when={tab().kind === "explorer"}
                  fallback={<PropertiesPanel store={props.store} paneId={props.paneId} />}
                >
                  <ExplorerPane store={props.store} paneId={props.paneId} />
                </Show>
              }
            >
              <EditorView store={props.store} tab={tab} />
            </Show>
          )}
        </Show>
      </div>
    </div>
  );
}

export function DockPanel(props: { store: WindowStore; panel: PanelId }) {
  // Key <For> by primitive pane ID so updating pane state NEVER destroys/remounts PaneView
  const paneIds = createMemo(() =>
    props.store.panesInPanel(props.panel).map((p) => p.id),
  );
  const isPanelFocused = () => props.store.focusedPanel() === props.panel;
  const ui = () => props.store.config().ui;
  const renderMode = () => props.store.config().editor.render_mode;

  return (
    <section
      class={`nib-dock nib-dock-${props.panel} ${isPanelFocused() ? "is-zone-focused" : ""}`}
      style={
        props.panel === "left" || props.panel === "right"
          ? { width: `${props.store.config().appearance.sidebar_width}px` }
          : undefined
      }
    >
      <div
        class={`nib-panel-panes ${props.panel === "left" || props.panel === "right" ? "is-vertical" : "is-horizontal"}`}
      >
        <For each={paneIds()}>
          {(paneId, idx) => (
            <PaneView
              store={props.store}
              paneId={paneId}
              paneIndex={idx}
              totalPanes={() => paneIds().length}
            />
          )}
        </For>
      </div>

      {/* Obsidian-style bottom utility rail in Left Side Panel */}
      <Show when={props.panel === "left"}>
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
                class={`nib-icon-btn ${renderMode() !== "raw" ? "is-accent" : ""}`}
                title={`Render: ${renderMode()}`}
                onClick={() => void props.store.cycleRenderMode()}
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
