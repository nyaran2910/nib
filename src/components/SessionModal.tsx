import { BookmarkPlus, Layers, Plus, Save, Trash2, X } from "lucide-solid";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import type { SessionRecord } from "../state/ipc";
import type { WindowStore } from "../state/store";

function formatSessionTree(rec: SessionRecord): string[] {
  const lines: string[] = [];
  for (const pane of rec.panes) {
    const hosted = rec.containers.filter((c) => c.pane_id === pane.id);
    if (hosted.length === 0) continue;
    const labels = hosted.map((c) => {
      if (c.kind === "editor") {
        const star = c.dirty ? "*" : "";
        return `${c.title}${star}`;
      }
      return c.title;
    });
    lines.push(`${pane.panel}: ${labels.join(", ")}`);
  }
  return lines;
}

function folderLabel(path?: string | null): string {
  if (!path) return "";
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function SessionModal(props: { store: WindowStore }) {
  let inputRef: HTMLInputElement | undefined;
  const [query, setQuery] = createSignal("");
  const [selectedIdx, setSelectedIdx] = createSignal(0);

  createEffect(() => {
    if (props.store.sessionModalOpen()) {
      setQuery("");
      setSelectedIdx(0);
      void props.store.refreshSessions();
      queueMicrotask(() => inputRef?.focus());
    }
  });

  const allSessions = createMemo<SessionRecord[]>(() => {
    const data = props.store.sessionStore();
    const q = query().trim().toLowerCase();
    const merged = [...data.named, ...data.history];
    if (!q) return merged;
    return merged.filter((s) => {
      const text = [
        s.name,
        s.kind,
        s.root_dir ?? "",
        ...s.containers.map((c) => `${c.title} ${c.path ?? ""}`),
      ]
        .join(" ")
        .toLowerCase();
      return text.includes(q);
    });
  });

  createEffect(() => {
    const max = Math.max(0, allSessions().length - 1);
    if (selectedIdx() > max) setSelectedIdx(max);
  });

  const attach = async (rec: SessionRecord) => {
    props.store.setSessionModalOpen(false);
    await props.store.restoreSession(rec.id);
  };

  const createNamedFromInput = async (fromCurrent: boolean) => {
    const raw = query().trim();
    const name = raw || `session-${props.store.sessionStore().named.length + 1}`;
    await props.store.createNamedSession(name, fromCurrent);
    setQuery("");
    props.store.setSessionModalOpen(false);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const list = allSessions();
    if (e.key === "Escape" || (e.ctrlKey && e.key === "g")) {
      e.preventDefault();
      props.store.setSessionModalOpen(false);
      props.store.focusEditor();
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
      const chosen = list[selectedIdx()];
      if (chosen && !e.shiftKey) {
        void attach(chosen);
      } else if (query().trim()) {
        void createNamedFromInput(true);
      }
    }
  };

  return (
    <Show when={props.store.sessionModalOpen()}>
      <div
        class="nib-modal-backdrop"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            props.store.setSessionModalOpen(false);
            props.store.focusEditor();
          }
        }}
      >
        <div
          class="nib-palette nib-session-modal"
          role="dialog"
          aria-label="Sessions"
          onKeyDown={handleKeyDown}
        >
          <div class="nib-palette-input-row">
            <Layers size={15} class="nib-container-picker-ico" />
            <input
              ref={inputRef}
              class="nib-palette-input"
              type="text"
              placeholder="Filter or type new session name…"
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
            />
            <button
              class="nib-icon-btn"
              title="Save Snapshot (Resurrect)"
              onClick={() => void props.store.saveCurrentSessionSnapshot()}
            >
              <Save size={14} />
            </button>
            <button
              class="nib-icon-btn"
              title="Close"
              onClick={() => {
                props.store.setSessionModalOpen(false);
                props.store.focusEditor();
              }}
            >
              <X size={15} />
            </button>
          </div>

          <div class="nib-session-actions-bar">
            <button
              class="nib-secondary-btn nib-session-action-btn"
              onClick={() => void createNamedFromInput(true)}
            >
              <BookmarkPlus size={13} />
              <span>Save current as named</span>
            </button>
            <button
              class="nib-secondary-btn nib-session-action-btn"
              onClick={() => void createNamedFromInput(false)}
            >
              <Plus size={13} />
              <span>New blank session</span>
            </button>
          </div>

          <div class="nib-palette-list">
            <Show
              when={allSessions().length > 0}
              fallback={<div class="nib-palette-empty">No saved sessions.</div>}
            >
              <For each={allSessions()}>
                {(rec, idx) => {
                  const isCurrent = () => props.store.currentSessionId() === rec.id;
                  const treeLines = () => formatSessionTree(rec);
                  return (
                    <div
                      class={`nib-palette-item nib-session-item ${idx() === selectedIdx() ? "is-active" : ""}`}
                      onMouseEnter={() => setSelectedIdx(idx())}
                      onClick={() => void attach(rec)}
                    >
                      <div class="nib-palette-item-top">
                        <div class="nib-session-title-wrap">
                          <span class="nib-palette-title">{rec.name}</span>
                          <span class={`nib-session-badge ${rec.kind === "named" ? "is-named" : ""}`}>
                            {rec.kind === "named" ? "NAMED" : "AUTO"}
                          </span>
                          <Show when={isCurrent()}>
                            <span class="nib-session-badge is-live">LIVE</span>
                          </Show>
                        </div>
                        <div class="nib-hit-badges">
                          <Show when={folderLabel(rec.root_dir)}>
                            <span class="nib-kbd-badge">{folderLabel(rec.root_dir)}</span>
                          </Show>
                          <span class="nib-kbd-badge">{rec.panes.length}p</span>
                          <button
                            class="nib-row-btn"
                            title="Delete Session"
                            onClick={(e) => {
                              e.stopPropagation();
                              void props.store.removeSession(rec.id);
                            }}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                      <div class="nib-session-tree-preview">
                        <For each={treeLines()}>
                          {(line) => <div class="nib-session-tree-line">{line}</div>}
                        </For>
                      </div>
                    </div>
                  );
                }}
              </For>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
