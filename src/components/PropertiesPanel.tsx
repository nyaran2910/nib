import { Plus, Trash2 } from "lucide-solid";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import type { WindowStore } from "../state/store";

interface FrontmatterEntry {
  key: string;
  value: string;
}

function parseFrontmatter(markdown: string): { entries: FrontmatterEntry[]; body: string } {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { entries: [], body: markdown };
  }
  const rawYaml = match[1] ?? "";
  const body = match[2] ?? "";
  const entries: FrontmatterEntry[] = [];

  const lines = rawYaml.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    if (colon > 0) {
      const key = trimmed.slice(0, colon).trim();
      let value = trimmed.slice(colon + 1).trim();
      if (!value) {
        const listItems: string[] = [];
        while (i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1] ?? "")) {
          i++;
          listItems.push((lines[i] ?? "").replace(/^\s+-\s+/, "").trim());
        }
        if (listItems.length > 0) value = `[${listItems.join(", ")}]`;
      }
      entries.push({ key, value });
    }
  }
  return { entries, body };
}

function serializeFrontmatter(entries: FrontmatterEntry[], body: string): string {
  const clean = entries.filter((e) => e.key.trim().length > 0);
  if (clean.length === 0) return body;
  const yaml = clean.map((e) => `${e.key.trim()}: ${e.value.trim()}`).join("\n");
  return `---\n${yaml}\n---\n${body}`;
}

export function PropertiesPanel(props: { store: WindowStore; paneId: string }) {
  let containerRef: HTMLDivElement | undefined;
  let addKeyRef: HTMLInputElement | undefined;
  let addValRef: HTMLInputElement | undefined;

  const [newKey, setNewKey] = createSignal("");
  const [newVal, setNewVal] = createSignal("");
  // Unified row index: 0 = top Add form, 1..N = existing entries
  const [cursorRow, setCursorRow] = createSignal(0);
  const [cursorCol, setCursorCol] = createSignal<"key" | "value">("key");
  const [editingInput, setEditingInput] = createSignal(false);

  const isVimMode = () => props.store.config().properties.keymap_mode !== "standard";

  const isFocused = () => {
    if (props.store.activePaneId() !== props.paneId) return false;
    const panel = props.store.panelOfPane(props.paneId);
    if (!props.store.isPanelVisible(panel)) return false;
    return props.store.activeContainerInPane(props.paneId)?.kind === "properties";
  };

  const parsed = createMemo(() => parseFrontmatter(props.store.content()));
  const totalRows = () => 1 + parsed().entries.length;

  createEffect(() => {
    const max = Math.max(0, totalRows() - 1);
    if (cursorRow() > max) setCursorRow(max);
  });

  createEffect(() => {
    if (
      isFocused() &&
      containerRef &&
      document.activeElement !== containerRef &&
      !containerRef.contains(document.activeElement)
    ) {
      queueMicrotask(() => containerRef?.focus());
    }
  });

  createEffect(() => {
    const row = cursorRow();
    if (isFocused()) {
      queueMicrotask(() => {
        const el = containerRef?.querySelector(`[data-prop-row="${row}"]`) as HTMLElement | null;
        el?.scrollIntoView({ block: "nearest" });
      });
    }
  });

  const commitEntries = (nextEntries: FrontmatterEntry[]) => {
    const updated = serializeFrontmatter(nextEntries, parsed().body);
    props.store.onEditorContentChange(updated);
  };

  const updateKey = (idx: number, key: string) => {
    const list = parsed().entries.map((e, i) => (i === idx ? { ...e, key } : e));
    commitEntries(list);
  };

  const updateValue = (idx: number, val: string) => {
    const list = parsed().entries.map((e, i) => (i === idx ? { ...e, value: val } : e));
    commitEntries(list);
  };

  const removeEntry = (idx: number) => {
    const list = parsed().entries.filter((_, i) => i !== idx);
    commitEntries(list);
  };

  const addEntry = (): boolean => {
    const k = newKey().trim();
    if (!k) return false;
    commitEntries([{ key: k, value: newVal().trim() }, ...parsed().entries]);
    setNewKey("");
    setNewVal("");
    return true;
  };

  const focusField = (row: number, col: "key" | "value") => {
    setCursorRow(row);
    setCursorCol(col);
    queueMicrotask(() => {
      let input: HTMLInputElement | null = null;
      if (row === 0) {
        input = col === "key" ? (addKeyRef ?? null) : (addValRef ?? null);
      } else {
        input =
          containerRef?.querySelector<HTMLInputElement>(
            `[data-prop-row="${row}"] input[data-prop-col="${col}"]`,
          ) ?? null;
      }
      if (input) {
        input.focus();
        setEditingInput(true);
      }
    });
  };

  const exitInsertToNormal = () => {
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== containerRef) {
      active.blur();
    }
    setEditingInput(false);
    containerRef?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    const inInput = target?.tagName === "INPUT";

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (inInput) {
        exitInsertToNormal();
      } else {
        props.store.focusMainPanel();
      }
      return;
    }

    if (inInput) return;

    if (e.ctrlKey && e.key === "g") {
      e.preventDefault();
      props.store.focusMainPanel();
      return;
    }

    const rows = totalRows();

    // Common navigation (works in both Vim and Standard modes)
    if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
      e.preventDefault();
      setCursorRow((r) => Math.min(rows - 1, r + 1));
      return;
    }
    if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
      e.preventDefault();
      setCursorRow((r) => Math.max(0, r - 1));
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setCursorCol("key");
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      setCursorCol("value");
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      focusField(cursorRow(), cursorCol());
      return;
    }

    if (!isVimMode() || e.metaKey || e.ctrlKey || e.altKey) return;

    switch (e.key) {
      case "j":
        e.preventDefault();
        setCursorRow((r) => Math.min(rows - 1, r + 1));
        break;
      case "k":
        e.preventDefault();
        setCursorRow((r) => Math.max(0, r - 1));
        break;
      case "h":
        e.preventDefault();
        setCursorCol("key");
        break;
      case "l":
        e.preventDefault();
        setCursorCol("value");
        break;
      case "i":
      case "a":
        e.preventDefault();
        focusField(cursorRow(), cursorCol());
        break;
      case "o":
        e.preventDefault();
        focusField(0, "key");
        break;
      case "d":
      case "x": {
        e.preventDefault();
        const row = cursorRow();
        if (row >= 1) {
          removeEntry(row - 1);
        }
        break;
      }
    }
  };

  return (
    <div
      ref={containerRef}
      class="nib-properties-panel"
      tabIndex={0}
      onFocus={(e) => {
        if (e.target === containerRef) setEditingInput(false);
        if (props.store.activePaneId() !== props.paneId) {
          props.store.focusPane(props.paneId, false);
        }
      }}
      onKeyDown={handleKeyDown}
    >
      {/* Top Add Key/Value Form (Row 0) */}
      <div
        data-prop-row="0"
        class={`nib-prop-add ${cursorRow() === 0 && isFocused() ? "is-cursor" : ""}`}
        onClick={() => setCursorRow(0)}
      >
        <div class="nib-prop-add-header">
          <Show when={isVimMode() && isFocused()}>
            <span class={`nib-prop-mode ${editingInput() ? "is-insert" : ""}`}>
              {editingInput() ? "INSERT" : "NORMAL"}
            </span>
          </Show>
        </div>
        <input
          ref={addKeyRef}
          data-prop-col="key"
          class={`nib-prop-input ${cursorRow() === 0 && cursorCol() === "key" && isFocused() && !editingInput() ? "is-field-cursor" : ""}`}
          placeholder="key"
          value={newKey()}
          onFocus={() => {
            setCursorRow(0);
            setCursorCol("key");
            setEditingInput(true);
          }}
          onBlur={() => setEditingInput(false)}
          onInput={(e) => setNewKey(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (newKey().trim() && !newVal().trim()) {
                focusField(0, "value");
              } else if (addEntry() && isVimMode()) {
                exitInsertToNormal();
              }
            }
          }}
        />
        <div class="nib-prop-add-row">
          <input
            ref={addValRef}
            data-prop-col="value"
            class={`nib-prop-input ${cursorRow() === 0 && cursorCol() === "value" && isFocused() && !editingInput() ? "is-field-cursor" : ""}`}
            placeholder="value"
            value={newVal()}
            onFocus={() => {
              setCursorRow(0);
              setCursorCol("value");
              setEditingInput(true);
            }}
            onBlur={() => setEditingInput(false)}
            onInput={(e) => setNewVal(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (addEntry() && isVimMode()) {
                  exitInsertToNormal();
                }
              }
            }}
          />
          <button
            class="nib-icon-btn"
            title="Add"
            onClick={() => {
              addEntry();
            }}
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* Existing Frontmatter Entries (Rows 1..N) */}
      <div class="nib-prop-list">
        <For each={parsed().entries}>
          {(entry, idx) => {
            const rowNum = () => idx() + 1;
            const isRowActive = () => cursorRow() === rowNum() && isFocused();
            return (
              <div
                data-prop-row={rowNum()}
                class={`nib-prop-row ${isRowActive() ? "is-cursor" : ""}`}
                onClick={() => setCursorRow(rowNum())}
              >
                <div class="nib-prop-key-row">
                  <input
                    data-prop-col="key"
                    class={`nib-prop-key-input ${isRowActive() && cursorCol() === "key" && !editingInput() ? "is-field-cursor" : ""}`}
                    value={entry.key}
                    onFocus={() => {
                      setCursorRow(rowNum());
                      setCursorCol("key");
                      setEditingInput(true);
                    }}
                    onBlur={() => setEditingInput(false)}
                    onInput={(e) => updateKey(idx(), e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && isVimMode()) {
                        e.preventDefault();
                        exitInsertToNormal();
                      }
                    }}
                  />
                  <button
                    class="nib-row-btn"
                    title="Remove"
                    onClick={() => removeEntry(idx())}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                <input
                  data-prop-col="value"
                  class={`nib-prop-input ${isRowActive() && cursorCol() === "value" && !editingInput() ? "is-field-cursor" : ""}`}
                  value={entry.value}
                  onFocus={() => {
                    setCursorRow(rowNum());
                    setCursorCol("value");
                    setEditingInput(true);
                  }}
                  onBlur={() => setEditingInput(false)}
                  onInput={(e) => updateValue(idx(), e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && isVimMode()) {
                      e.preventDefault();
                      exitInsertToNormal();
                    }
                  }}
                />
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}
