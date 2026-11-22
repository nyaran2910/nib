import {
  Columns2,
  Command,
  CopyPlus,
  FileText,
  Files,
  PanelLeft,
  Plus,
  Puzzle,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  X,
} from "lucide-solid";
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { pluginRegistry } from "../plugins/registry";
import type { ContainerKind, ContainerTab, PanelId, WindowStore } from "../state/store";
import { EditorView } from "./EditorView";
import { ExplorerPane } from "./ExplorerPane";
import { PropertiesPanel } from "./PropertiesPanel";

const BUILTIN_CONTAINERS: Array<{ kind: ContainerKind; title: string; keywords: string }> = [
  { kind: "editor", title: "Editor", keywords: "editor markdown note write text" },
  { kind: "explorer", title: "Explorer", keywords: "explorer files folder tree sidebar" },
  { kind: "properties", title: "Properties", keywords: "properties frontmatter yaml metadata tags" },
];

function PluginContainerView(props: { tab: () => ContainerTab; paneId: string }) {
  let hostEl: HTMLDivElement | undefined;
  let cleanup: (() => void) | void;

  onMount(() => {
    const def = pluginRegistry.getContainer(props.tab().kind);
    if (hostEl && def) {
      cleanup = def.mount(hostEl, {
        containerId: props.tab().id,
        paneId: props.paneId,
        api: pluginRegistry.createAPI(`container:${props.tab().kind}`),
      });
    }
    onCleanup(() => {
      if (typeof cleanup === "function") cleanup();
    });
  });

  return <div class="nib-plugin-container" ref={hostEl} />;
}

function ContainerPicker(props: { store: WindowStore; paneId: string; isFocused: () => boolean }) {
  let inputRef: HTMLInputElement | undefined;
  const [query, setQuery] = createSignal("");
  const [selectedIdx, setSelectedIdx] = createSignal(0);
  const [pluginVer, setPluginVer] = createSignal(0);
  const unsub = pluginRegistry.onChange(() => setPluginVer((v) => v + 1));
  onCleanup(unsub);

  const allContainers = createMemo(() => {
    pluginVer();
    const custom = pluginRegistry.getContainers().map((c) => ({
      kind: c.kind as ContainerKind,
      title: c.title,
      keywords: (c.keywords ?? [c.title, c.kind]).join(" "),
    }));
    return [...BUILTIN_CONTAINERS, ...custom];
  });

  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase();
    const list = allContainers();
    if (!q) return list;
    return list.filter((c) => `${c.title} ${c.keywords}`.toLowerCase().includes(q));
  });

  createEffect(() => {
    filtered();
    setSelectedIdx(0);
  });

  createEffect(() => {
    if (props.isFocused() && document.activeElement !== inputRef) {
      queueMicrotask(() => inputRef?.focus());
    }
  });

  const openChosen = (kind?: ContainerKind) => {
    const chosen = kind ?? filtered()[selectedIdx()]?.kind;
    if (!chosen) return;
    props.store.openContainerKindInPane(props.paneId, chosen);
  };

  const renderIcon = (kind: ContainerKind) => {
    if (kind === "editor") return <FileText size={14} />;
    if (kind === "explorer") return <Files size={14} />;
    if (kind === "properties") return <SlidersHorizontal size={14} />;
    return <Puzzle size={14} />;
  };

  return (
    <div class="nib-empty-pane">
      <div class="nib-container-picker">
        <div class="nib-container-picker-input-row">
          <Search size={13} class="nib-container-picker-ico" />
          <input
            ref={inputRef}
            class="nib-container-picker-input"
            type="text"
            placeholder="Container…"
            value={query()}
            onFocus={() => {
              if (props.store.activePaneId() !== props.paneId) {
                props.store.focusPane(props.paneId, false);
              }
            }}
            onInput={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              const list = filtered();
              if (e.key === "Escape") {
                e.preventDefault();
                if (query().length > 0) setQuery("");
                else props.store.focusMainPanel();
                return;
              }
              if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
                e.preventDefault();
                if (list.length > 0) setSelectedIdx((i) => (i + 1) % list.length);
                return;
              }
              if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
                e.preventDefault();
                if (list.length > 0) setSelectedIdx((i) => (i - 1 + list.length) % list.length);
                return;
              }
              if (e.key === "Enter") {
                e.preventDefault();
                openChosen();
              }
            }}
          />
        </div>
        <div class="nib-container-picker-list">
          <For each={filtered()}>
            {(item, idx) => (
              <button
                class={`nib-container-picker-item ${idx() === selectedIdx() ? "is-active" : ""}`}
                onMouseEnter={() => setSelectedIdx(idx())}
                onClick={() => openChosen(item.kind)}
              >
                {renderIcon(item.kind)}
                <span>{item.title}</span>
              </button>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

function PaneView(props: {
  store: WindowStore;
  paneId: string;
  paneIndex: () => number;
  totalPanes: () => number;
}) {
  const panel = createMemo(() => props.store.panelOfPane(props.paneId));
  const tabIds = createMemo(() =>
    props.store.containersInPane(props.paneId).map((c) => c.id),
  );
  const getTab = (id: string) => props.store.containers().find((c) => c.id === id);
  const activeTab = createMemo<ContainerTab | undefined>(() =>
    props.store.activeContainerInPane(props.paneId),
  );
  const isPaneFocused = () => props.store.activePaneId() === props.paneId;
  const isDragTarget = () => props.store.dragState()?.hoverPaneId === props.paneId;
  const ui = () => props.store.config().ui;
  const showHeader = () => (panel() === "center" ? ui().show_topbar : true);
  const needsTrafficLightPad = () =>
    props.paneIndex() === 0 &&
    (panel() === "left" || (panel() === "center" && !props.store.isPanelVisible("left")));
  const allowWindowDrag = () =>
    props.paneIndex() === 0 && (panel() === "left" || panel() === "center");

  const renderNonEditorIcon = (kind: ContainerTab["kind"]) => {
    if (kind === "explorer") return <Files size={15} />;
    if (kind === "properties") return <SlidersHorizontal size={15} />;
    return <Puzzle size={15} />;
  };

  return (
    <div
      data-drop-pane={props.paneId}
      class={`nib-pane ${isPaneFocused() ? "is-pane-focused" : ""} ${isDragTarget() ? "is-drag-over" : ""}`}
      style={{ flex: `${props.store.paneWeight(props.paneId)} 1 0%` }}
      onMouseDown={() => {
        if (props.store.activePaneId() !== props.paneId) {
          props.store.focusPane(props.paneId, false);
        }
      }}
    >
      <Show when={showHeader()}>
        <header class={`nib-dock-header ${needsTrafficLightPad() ? "is-left-chrome" : ""}`}>
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
                const isBeingDragged = () => props.store.dragState()?.containerId === tabId;
                return (
                  <Show when={tab()}>
                    {(t) => (
                      <div
                        role="tab"
                        aria-selected={isActive()}
                        class={`nib-tab ${isEditor() ? "nib-tab-editor" : "nib-tab-icon-only"} ${isActive() ? "is-active" : ""} ${isBeingDragged() ? "is-dragging" : ""}`}
                        onPointerDown={(e) => props.store.startContainerDrag(tabId, e)}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (props.store.wasJustDragged()) return;
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

            <Show when={panel() === "center" && tabIds().length > 0}>
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

            {/* Dedicated window drag spacer so macOS titlebar dragging NEVER hijacks container tabs */}
            <div
              class="nib-drag-spacer"
              data-tauri-drag-region={allowWindowDrag() ? "" : undefined}
            />
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
            <ContainerPicker
              store={props.store}
              paneId={props.paneId}
              isFocused={isPaneFocused}
            />
          }
        >
          {(tab) => (
            <Show
              when={tab().kind === "editor"}
              fallback={
                <Show
                  when={tab().kind === "explorer"}
                  fallback={
                    <Show
                      when={tab().kind === "properties"}
                      fallback={<PluginContainerView tab={tab} paneId={props.paneId} />}
                    >
                      <PropertiesPanel store={props.store} paneId={props.paneId} />
                    </Show>
                  }
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
  const paneIds = createMemo(() =>
    props.store.panesInPanel(props.panel).map((p) => p.id),
  );
  const isPanelFocused = () => props.store.focusedPanel() === props.panel;
  const ui = () => props.store.config().ui;
  const renderMode = () => props.store.config().editor.render_mode;

  const panelStyle = () => {
    if (props.panel === "left") return { width: `${props.store.leftPanelWidth()}px` };
    if (props.panel === "right") return { width: `${props.store.rightPanelWidth()}px` };
    if (props.panel === "bottom") return { height: `${props.store.bottomPanelHeight()}px` };
    return undefined;
  };

  return (
    <section
      class={`nib-dock nib-dock-${props.panel} ${isPanelFocused() ? "is-zone-focused" : ""}`}
      style={panelStyle()}
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
