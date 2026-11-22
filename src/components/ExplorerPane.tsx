import {
  Check,
  ChevronDown,
  ChevronRight,
  CopyPlus,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  Pencil,
  Search,
  Trash2,
} from "lucide-solid";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { confirmDialog, type FileNode } from "../state/ipc";
import type { WindowStore } from "../state/store";

interface FlatTreeItem {
  node: FileNode;
  depth: number;
  parentPath: string | null;
  isRoot?: boolean;
}

export function ExplorerPane(props: { store: WindowStore; paneId: string }) {
  let explorerRef: HTMLDivElement | undefined;
  let createInputRef: HTMLInputElement | undefined;
  let renameInputRef: HTMLInputElement | undefined;

  const [collapsedDirs, setCollapsedDirs] = createSignal<Set<string>>(new Set());
  const [cursorIndex, setCursorIndex] = createSignal<number>(0);
  const [selectedPaths, setSelectedPaths] = createSignal<Set<string>>(new Set());
  const [renamingPath, setRenamingPath] = createSignal<string | null>(null);
  const [renameDraft, setRenameDraft] = createSignal<string>("");
  const [createDraft, setCreateDraft] = createSignal<string>("");

  let renameDone = false;
  let createDone = false;

  const isFocused = () => {
    if (props.store.activePaneId() !== props.paneId) return false;
    const panel = props.store.panelOfPane(props.paneId);
    if (!props.store.isPanelVisible(panel)) return false;
    return props.store.activeContainerInPane(props.paneId)?.kind === "explorer";
  };

  /** Snacks.nvim-style tree: opened root directory renders at depth 0, children at depth >= 1 */
  const flatItems = createMemo<FlatTreeItem[]>(() => {
    const dir = props.store.rootDir();
    if (!dir) return [];
    const parts = dir.split("/").filter(Boolean);
    const rootName = parts[parts.length - 1] ?? dir;
    const rootNode: FileNode = {
      name: rootName,
      path: dir,
      is_dir: true,
      children: props.store.fileTree(),
    };

    const out: FlatTreeItem[] = [];
    const collapsed = collapsedDirs();

    out.push({ node: rootNode, depth: 0, parentPath: null, isRoot: true });
    if (!collapsed.has(rootNode.path)) {
      const walk = (nodes: FileNode[], depth: number, parentPath: string) => {
        for (const node of nodes) {
          out.push({ node, depth, parentPath, isRoot: false });
          if (node.is_dir && !collapsed.has(node.path)) {
            walk(node.children, depth + 1, node.path);
          }
        }
      };
      walk(rootNode.children, 1, rootNode.path);
    }
    return out;
  });

  createEffect(() => {
    const max = Math.max(0, flatItems().length - 1);
    if (cursorIndex() > max) setCursorIndex(max);
  });

  createEffect(() => {
    if (
      isFocused() &&
      explorerRef &&
      document.activeElement !== explorerRef &&
      !explorerRef.contains(document.activeElement)
    ) {
      queueMicrotask(() => explorerRef?.focus());
    }
  });

  createEffect(() => {
    const idx = cursorIndex();
    if (isFocused()) {
      queueMicrotask(() => {
        const el = explorerRef?.querySelector(`[data-tree-idx="${idx}"]`) as HTMLElement | null;
        el?.scrollIntoView({ block: "nearest" });
      });
    }
  });

  createEffect(() => {
    if (props.store.sidebarCreateMode()) {
      createDone = false;
      setCreateDraft("");
      queueMicrotask(() => createInputRef?.focus());
    }
  });

  const toggleDir = (dirPath: string, forceOpen?: boolean) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      const isClosed = next.has(dirPath);
      if (forceOpen === true) next.delete(dirPath);
      else if (forceOpen === false) next.add(dirPath);
      else if (isClosed) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
  };

  const getTargetDirForCursor = (): string | null => {
    const item = flatItems()[cursorIndex()];
    if (!item) return props.store.rootDir();
    if (item.node.is_dir) return item.node.path;
    return item.parentPath ?? props.store.rootDir();
  };

  const startRename = (node: FileNode) => {
    const display = node.is_dir ? node.name : node.name.replace(/\.(md|markdown)$/i, "");
    renameDone = false;
    setRenameDraft(display);
    setRenamingPath(node.path);
    queueMicrotask(() => {
      renameInputRef?.focus();
      renameInputRef?.select();
    });
  };

  const cancelRename = () => {
    renameDone = true;
    setRenamingPath(null);
    if (isFocused()) queueMicrotask(() => explorerRef?.focus());
  };

  const commitRename = () => {
    if (renameDone) return;
    renameDone = true;
    const path = renamingPath();
    const val = renameDraft().trim();
    setRenamingPath(null);
    if (path && val) void props.store.renameItem(path, val);
    if (isFocused()) queueMicrotask(() => explorerRef?.focus());
  };

  const cancelCreate = () => {
    createDone = true;
    props.store.setSidebarCreateMode(null);
    if (isFocused()) queueMicrotask(() => explorerRef?.focus());
  };

  const commitCreate = () => {
    if (createDone) return;
    createDone = true;
    const mode = props.store.sidebarCreateMode();
    const val = createDraft().trim();
    props.store.setSidebarCreateMode(null);
    if (!val) return;
    const targetDir = getTargetDirForCursor();
    if (mode === "note") void props.store.createNoteInline(val, targetDir);
    else if (mode === "folder") void props.store.createFolderInline(val, targetDir);
  };

  const toggleSelectPath = (path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleExplorerKeyDown = (e: KeyboardEvent) => {
    if (renamingPath() || props.store.sidebarCreateMode()) return;

    const list = flatItems();
    const item = list[cursorIndex()];
    const mode = props.store.config().explorer.keymap_mode;

    if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
      e.preventDefault();
      if (list.length > 0) setCursorIndex((i) => Math.min(list.length - 1, i + 1));
      return;
    }
    if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
      e.preventDefault();
      if (list.length > 0) setCursorIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (!item) return;
      if (item.node.is_dir) toggleDir(item.node.path);
      else void props.store.openFile(item.node.path).then(() => props.store.focusEditor());
      return;
    }
    if (e.key === "Escape" || (e.ctrlKey && e.key === "g")) {
      e.preventDefault();
      if (selectedPaths().size > 0) setSelectedPaths(new Set<string>());
      else props.store.focusMainPanel();
      return;
    }

    if (mode === "standard") {
      return;
    }

    if (mode === "emacs") {
      if (e.ctrlKey && e.key === "f") {
        e.preventDefault();
        if (!item) return;
        if (item.node.is_dir) {
          if (collapsedDirs().has(item.node.path)) toggleDir(item.node.path, true);
          else if (item.node.children.length > 0 && cursorIndex() + 1 < list.length) {
            setCursorIndex(cursorIndex() + 1);
          }
        } else {
          void props.store.openFile(item.node.path);
        }
      } else if (e.ctrlKey && e.key === "b") {
        e.preventDefault();
        if (!item) return;
        if (item.node.is_dir && !collapsedDirs().has(item.node.path)) {
          toggleDir(item.node.path, false);
        } else if (item.parentPath) {
          const parentIdx = list.findIndex((x) => x.node.path === item.parentPath);
          if (parentIdx >= 0) setCursorIndex(parentIdx);
        }
      }
      return;
    }

    if (e.metaKey || e.ctrlKey || e.altKey) return;

    switch (e.key) {
      case "j":
        e.preventDefault();
        if (list.length > 0) setCursorIndex((i) => Math.min(list.length - 1, i + 1));
        break;
      case "k":
        e.preventDefault();
        if (list.length > 0) setCursorIndex((i) => Math.max(0, i - 1));
        break;
      case "l":
        e.preventDefault();
        if (!item) return;
        if (item.node.is_dir) {
          if (collapsedDirs().has(item.node.path)) toggleDir(item.node.path, true);
          else if (item.node.children.length > 0 && cursorIndex() + 1 < list.length) {
            setCursorIndex(cursorIndex() + 1);
          }
        } else {
          void props.store.openFile(item.node.path);
        }
        break;
      case "h":
        e.preventDefault();
        if (!item) return;
        if (item.node.is_dir && !collapsedDirs().has(item.node.path)) {
          toggleDir(item.node.path, false);
        } else if (item.parentPath) {
          const parentIdx = list.findIndex((x) => x.node.path === item.parentPath);
          if (parentIdx >= 0) setCursorIndex(parentIdx);
        }
        break;
      case "o":
        e.preventDefault();
        if (item) void props.store.openExternal(item.node.path);
        break;
      case "Tab":
        e.preventDefault();
        if (item && !item.isRoot) {
          toggleSelectPath(item.node.path);
          if (cursorIndex() < list.length - 1) setCursorIndex((i) => i + 1);
        }
        break;
      case "a":
        e.preventDefault();
        props.store.setSidebarCreateMode("note");
        break;
      case "A":
        e.preventDefault();
        props.store.setSidebarCreateMode("folder");
        break;
      case "m": {
        e.preventDefault();
        const marked = Array.from(selectedPaths());
        if (marked.length > 0) {
          const dest = getTargetDirForCursor();
          if (dest) {
            void props.store.moveItems(marked, dest);
            setSelectedPaths(new Set<string>());
          }
        } else if (item && !item.isRoot) {
          startRename(item.node);
        }
        break;
      }
      case "c": {
        e.preventDefault();
        const marked = Array.from(selectedPaths());
        const sources = marked.length > 0 ? marked : item && !item.isRoot ? [item.node.path] : [];
        const dest = getTargetDirForCursor();
        if (sources.length > 0 && dest) {
          void props.store.copyItems(sources, dest);
          setSelectedPaths(new Set<string>());
        }
        break;
      }
      case "d": {
        e.preventDefault();
        const marked = Array.from(selectedPaths());
        const targets = marked.length > 0 ? marked : item && !item.isRoot ? [item.node.path] : [];
        if (targets.length === 0) return;
        void (async () => {
          const ok = await confirmDialog(`Delete ${targets.length} item(s)?`, "Delete");
          if (!ok) return;
          for (const p of targets) await props.store.deleteItem(p);
          setSelectedPaths(new Set<string>());
        })();
        break;
      }
    }
  };

  return (
    <div class="nib-explorer-pane">
      <Show when={props.store.config().ui.show_sidebar_search}>
        <div class="nib-sidebar-search-wrap">
          <button
            class="nib-sidebar-search-btn"
            onClick={() => props.store.openSearch("omni")}
          >
            <span class="nib-sidebar-search-left">
              <Search size={13} />
              <span>Search…</span>
            </span>
            <span class="nib-kbd-badge">⌘K</span>
          </button>
        </div>
      </Show>

      <Show when={props.store.sidebarCreateMode()}>
        <div class="nib-inline-create-row">
          <input
            ref={createInputRef}
            class="nib-inline-input"
            placeholder={
              props.store.sidebarCreateMode() === "folder" ? "Folder name" : "Note name"
            }
            value={createDraft()}
            onInput={(e) => setCreateDraft(e.currentTarget.value)}
            onBlur={commitCreate}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitCreate();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelCreate();
              }
            }}
          />
        </div>
      </Show>

      <Show
        when={props.store.rootDir()}
        fallback={
          <div class="nib-sidebar-empty">
            <button class="nib-primary-btn" onClick={() => void props.store.openFolderPicker()}>
              Open Folder…
            </button>
          </div>
        }
      >
        <div
          ref={explorerRef}
          class="nib-tree"
          tabIndex={0}
          onFocus={() => {
            if (props.store.activePaneId() !== props.paneId) {
              props.store.focusPane(props.paneId, false);
            }
          }}
          onKeyDown={handleExplorerKeyDown}
        >
          <For each={flatItems()}>
            {(item, idx) => {
              const isOpenFile = () =>
                !item.node.is_dir && props.store.activeFilePath() === item.node.path;
              const isCursor = () => isFocused() && idx() === cursorIndex();
              const isMarked = () => selectedPaths().has(item.node.path);
              const isExpanded = () => !collapsedDirs().has(item.node.path);
              const displayName = () =>
                item.node.is_dir
                  ? item.node.name
                  : item.node.name.replace(/\.(md|markdown)$/i, "");

              return (
                <div
                  data-tree-idx={idx()}
                  class={`nib-tree-item ${item.isRoot ? "is-root" : ""} ${isOpenFile() ? "is-active" : ""} ${isCursor() ? "is-cursor" : ""} ${isMarked() ? "is-marked" : ""}`}
                  style={{ "padding-left": `${8 + item.depth * 16}px` }}
                  onClick={() => {
                    setCursorIndex(idx());
                    props.store.focusPane(props.paneId);
                    if (renamingPath() === item.node.path) return;
                    if (item.node.is_dir) toggleDir(item.node.path);
                    else void props.store.openFile(item.node.path);
                  }}
                  onDblClick={() => {
                    if (!item.node.is_dir && !renamingPath()) {
                      void props.store.openAnotherWindow(props.store.rootDir(), item.node.path);
                    }
                  }}
                  title={item.node.path}
                >
                  <For each={Array.from({ length: item.depth })}>
                    {(_, gIdx) => (
                      <span
                        class="nib-tree-guide"
                        style={{ left: `${14 + gIdx() * 16}px` }}
                      />
                    )}
                  </For>

                  <span class="nib-tree-chevron">
                    <Show when={item.node.is_dir}>
                      {isExpanded() ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    </Show>
                  </span>

                  <span class={`nib-tree-icon ${item.node.is_dir ? "is-dir" : ""}`}>
                    <Show when={item.node.is_dir} fallback={<FileText size={14} />}>
                      {isExpanded() ? <FolderOpen size={14} /> : <Folder size={14} />}
                    </Show>
                  </span>

                  <Show
                    when={renamingPath() !== item.node.path}
                    fallback={
                      <input
                        ref={renameInputRef}
                        class="nib-inline-input"
                        value={renameDraft()}
                        onClick={(e) => e.stopPropagation()}
                        onInput={(e) => setRenameDraft(e.currentTarget.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            commitRename();
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            cancelRename();
                          }
                        }}
                      />
                    }
                  >
                    <span class="nib-tree-name">{displayName()}</span>

                    <Show when={isMarked()}>
                      <span class="nib-mark-badge">
                        <Check size={11} />
                      </span>
                    </Show>

                    <div class="nib-tree-row-actions">
                      <Show when={!item.node.is_dir}>
                        <button
                          class="nib-row-btn"
                          title="New Window"
                          onClick={(e) => {
                            e.stopPropagation();
                            void props.store.openAnotherWindow(
                              props.store.rootDir(),
                              item.node.path,
                            );
                          }}
                        >
                          <CopyPlus size={12} />
                        </button>
                      </Show>
                      <button
                        class="nib-row-btn"
                        title="Open Externally"
                        onClick={(e) => {
                          e.stopPropagation();
                          void props.store.openExternal(item.node.path);
                        }}
                      >
                        <ExternalLink size={12} />
                      </button>
                      <Show when={!item.isRoot}>
                        <button
                          class="nib-row-btn"
                          title="Rename"
                          onClick={(e) => {
                            e.stopPropagation();
                            startRename(item.node);
                          }}
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          class="nib-row-btn"
                          title="Delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            void (async () => {
                              const ok = await confirmDialog(`Delete "${item.node.name}"?`, "Delete");
                              if (ok) await props.store.deleteItem(item.node.path);
                            })();
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </Show>
                    </div>
                  </Show>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}
