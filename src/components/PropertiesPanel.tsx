import { Plus, Trash2 } from "lucide-solid";
import { For, createEffect, createMemo, createSignal } from "solid-js";
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
  const [newKey, setNewKey] = createSignal("");
  const [newVal, setNewVal] = createSignal("");
  const [activeIdx, setActiveIdx] = createSignal(0);

  const isFocused = () => {
    if (props.store.activePaneId() !== props.paneId) return false;
    const panel = props.store.panelOfPane(props.paneId);
    if (!props.store.isPanelVisible(panel)) return false;
    return props.store.activeContainerInPane(props.paneId)?.kind === "properties";
  };

  const parsed = createMemo(() => parseFrontmatter(props.store.content()));

  createEffect(() => {
    if (isFocused()) {
      queueMicrotask(() => containerRef?.focus());
    }
  });

  const commitEntries = (nextEntries: FrontmatterEntry[]) => {
    const updated = serializeFrontmatter(nextEntries, parsed().body);
    props.store.onEditorContentChange(updated);
  };

  const updateValue = (idx: number, val: string) => {
    const list = parsed().entries.map((e, i) => (i === idx ? { ...e, value: val } : e));
    commitEntries(list);
  };

  const removeEntry = (idx: number) => {
    const list = parsed().entries.filter((_, i) => i !== idx);
    commitEntries(list);
  };

  const addEntry = () => {
    const k = newKey().trim();
    if (!k) return;
    commitEntries([...parsed().entries, { key: k, value: newVal().trim() }]);
    setNewKey("");
    setNewVal("");
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    const inInput = target?.tagName === "INPUT";
    if (e.key === "Escape") {
      e.preventDefault();
      if (inInput) {
        target?.blur();
        containerRef?.focus();
      } else {
        props.store.focusMainPanel();
      }
      return;
    }
    if (inInput) return;

    const len = parsed().entries.length;
    if (len === 0) return;
    if (e.key === "j" || e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % len);
    } else if (e.key === "k" || e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + len) % len);
    } else if (e.ctrlKey && e.key === "g") {
      e.preventDefault();
      props.store.focusMainPanel();
    }
  };

  return (
    <div
      ref={containerRef}
      class="nib-properties-panel"
      tabIndex={0}
      onFocus={() => props.store.focusPane(props.paneId)}
      onKeyDown={handleKeyDown}
    >
      <div class="nib-prop-list">
        <For each={parsed().entries}>
          {(entry, idx) => (
            <div
              class={`nib-prop-row ${idx() === activeIdx() && isFocused() ? "is-cursor" : ""}`}
              onClick={() => setActiveIdx(idx())}
            >
              <div class="nib-prop-key-row">
                <span class="nib-prop-key">{entry.key}</span>
                <button
                  class="nib-row-btn"
                  title="Remove"
                  onClick={() => removeEntry(idx())}
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <input
                class="nib-prop-input"
                value={entry.value}
                onInput={(e) => updateValue(idx(), e.currentTarget.value)}
              />
            </div>
          )}
        </For>
      </div>

      <div class="nib-prop-add">
        <input
          class="nib-prop-input"
          placeholder="key"
          value={newKey()}
          onInput={(e) => setNewKey(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addEntry();
          }}
        />
        <div class="nib-prop-add-row">
          <input
            class="nib-prop-input"
            placeholder="value"
            value={newVal()}
            onInput={(e) => setNewVal(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addEntry();
            }}
          />
          <button class="nib-icon-btn" title="Add" onClick={addEntry}>
            <Plus size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
