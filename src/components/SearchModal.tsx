import { For, Show, createEffect, createSignal } from "solid-js";
import {
  listTags,
  searchNotes,
  type SearchHit,
  type SearchMode,
  type TagCount,
} from "../state/ipc";
import type { WindowStore } from "../state/store";

const MODES: Array<{ id: SearchMode; label: string; hint: string }> = [
  { id: "omni", label: "Omni", hint: "Files + Tags + Content (supports #tag)" },
  { id: "files", label: "Files", hint: "fzf fuzzy filename & path" },
  { id: "content", label: "Content", hint: "Fuzzy search inside note body" },
  { id: "tags", label: "Tags", hint: "Filter notes by #tag" },
];

export function SearchModal(props: { store: WindowStore }) {
  let inputRef: HTMLInputElement | undefined;
  const [query, setQuery] = createSignal("");
  const [selectedTag, setSelectedTag] = createSignal<string | null>(null);
  const [results, setResults] = createSignal<SearchHit[]>([]);
  const [tags, setTags] = createSignal<TagCount[]>([]);
  const [activeIndex, setActiveIndex] = createSignal(0);

  let requestSeq = 0;

  const runQuery = async () => {
    const seq = ++requestSeq;
    const mode = props.store.searchMode();
    const q = query();
    const tf = selectedTag();
    const [hits, tagList] = await Promise.all([
      searchNotes(q, mode, tf, 35),
      mode === "tags" || q.includes("#") ? listTags(q.replace(/^#/, "")) : Promise.resolve([]),
    ]);
    // Ignore stale responses from slower earlier IPC calls
    if (seq !== requestSeq) return;
    setResults(hits);
    setTags(tagList);
    setActiveIndex(0);
  };

  createEffect(() => {
    if (props.store.searchModalOpen()) {
      setQuery("");
      setSelectedTag(null);
      setActiveIndex(0);
      queueMicrotask(() => {
        inputRef?.focus();
        void runQuery();
      });
    }
  });

  createEffect(() => {
    if (!props.store.searchModalOpen()) return;
    // Track reactive dependencies
    props.store.searchMode();
    query();
    selectedTag();
    void runQuery();
  });

  const openHit = async (hit: SearchHit) => {
    props.store.setSearchModalOpen(false);
    await props.store.openFile(hit.path, hit.line);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const list = results();
    if (e.key === "Escape" || (e.ctrlKey && e.key === "g")) {
      e.preventDefault();
      props.store.setSearchModalOpen(false);
      props.store.focusEditor();
      return;
    }
    if (e.key === "Tab" || (e.ctrlKey && e.key === "f") || (e.ctrlKey && e.key === "b")) {
      e.preventDefault();
      const back = e.shiftKey || (e.ctrlKey && e.key === "b");
      const idx = MODES.findIndex((m) => m.id === props.store.searchMode());
      const next = MODES[(idx + (back ? MODES.length - 1 : 1)) % MODES.length];
      props.store.setSearchMode(next.id);
      return;
    }
    if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
      e.preventDefault();
      if (list.length > 0) setActiveIndex((i) => (i + 1) % list.length);
      return;
    }
    if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
      e.preventDefault();
      if (list.length > 0) setActiveIndex((i) => (i - 1 + list.length) % list.length);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const chosen = list[activeIndex()];
      if (chosen) {
        void openHit(chosen);
      }
    }
  };

  const activeHint = () =>
    MODES.find((m) => m.id === props.store.searchMode())?.hint ?? "Search notes...";

  return (
    <Show when={props.store.searchModalOpen()}>
      <div
        class="nib-modal-backdrop"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            props.store.setSearchModalOpen(false);
            props.store.focusEditor();
          }
        }}
      >
        <div class="nib-palette" role="dialog" aria-label="Fuzzy Search" onKeyDown={handleKeyDown}>
          <div class="nib-search-tabs">
            <For each={MODES}>
              {(m) => (
                <button
                  class={`nib-search-tab ${props.store.searchMode() === m.id ? "is-active" : ""}`}
                  onClick={() => {
                    props.store.setSearchMode(m.id);
                    inputRef?.focus();
                  }}
                >
                  {m.label}
                </button>
              )}
            </For>
          </div>

          <div class="nib-palette-input-row">
            <Show when={selectedTag()}>
              <button
                class="nib-tag-chip is-selected"
                onClick={() => setSelectedTag(null)}
                title="Clear tag filter"
              >
                #{selectedTag()} ✕
              </button>
            </Show>
            <input
              ref={inputRef}
              class="nib-palette-input"
              type="text"
              placeholder={activeHint()}
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
            />
          </div>

          <Show when={props.store.searchMode() === "tags" && tags().length > 0}>
            <div class="nib-tag-bar">
              <For each={tags().slice(0, 18)}>
                {(t) => (
                  <button
                    class={`nib-tag-chip ${selectedTag() === t.tag ? "is-selected" : ""}`}
                    onClick={() => setSelectedTag((cur) => (cur === t.tag ? null : t.tag))}
                  >
                    #{t.tag} <span class="nib-tag-count">{t.count}</span>
                  </button>
                )}
              </For>
            </div>
          </Show>

          <div class="nib-palette-list">
            <Show
              when={results().length > 0}
              fallback={
                <div class="nib-palette-empty">
                  {props.store.rootDir()
                    ? "No matching notes found."
                    : "Open a folder (Cmd+O) to index and fuzzy-search your Markdown notes."}
                </div>
              }
            >
              <For each={results()}>
                {(hit, idx) => (
                  <div
                    class={`nib-palette-item ${idx() === activeIndex() ? "is-active" : ""}`}
                    onMouseEnter={() => setActiveIndex(idx())}
                    onClick={() => void openHit(hit)}
                  >
                    <div class="nib-palette-item-top">
                      <span class="nib-palette-title">{hit.title}</span>
                      <div class="nib-hit-badges">
                        <Show when={hit.line}>
                          <span class="nib-kbd-badge">L{hit.line}</span>
                        </Show>
                        <For each={hit.matched_by}>
                          {(b) => <span class="nib-match-badge">{b}</span>}
                        </For>
                      </div>
                    </div>
                    <div class="nib-palette-sub">{hit.snippet || hit.relative_path}</div>
                  </div>
                )}
              </For>
            </Show>
          </div>

          <div class="nib-palette-footer">
            <span>Tab: switch mode</span>
            <span>↑↓ / Ctrl+N,P: navigate · Enter: open · Esc: close</span>
          </div>
        </div>
      </div>
    </Show>
  );
}
