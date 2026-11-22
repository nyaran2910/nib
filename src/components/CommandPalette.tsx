import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { pluginRegistry } from "../plugins/registry";
import type { NibCommand } from "../plugins/types";
import type { WindowStore } from "../state/store";

function fuzzyMatch(query: string, target: string): boolean {
  const q = query.trim().toLowerCase().replace(/\s+/g, "");
  if (!q) return true;
  const t = target.toLowerCase();
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

export function CommandPalette(props: { store: WindowStore }) {
  let inputRef: HTMLInputElement | undefined;
  const [query, setQuery] = createSignal("");
  const [activeIndex, setActiveIndex] = createSignal(0);
  const [cmdVersion, setCmdVersion] = createSignal(0);

  const unsub = pluginRegistry.onChange(() => setCmdVersion((v) => v + 1));
  onCleanup(unsub);

  const filteredCommands = createMemo<NibCommand[]>(() => {
    cmdVersion();
    const q = query();
    return pluginRegistry
      .getCommands()
      .filter((cmd) => fuzzyMatch(q, `${cmd.category ?? ""} ${cmd.title} ${cmd.id}`));
  });

  createEffect(() => {
    if (props.store.commandPaletteOpen()) {
      setQuery("");
      setActiveIndex(0);
      queueMicrotask(() => inputRef?.focus());
    }
  });

  createEffect(() => {
    filteredCommands();
    setActiveIndex(0);
  });

  const execute = async (cmd: NibCommand) => {
    props.store.setCommandPaletteOpen(false);
    await pluginRegistry.runCommand(cmd.id, {
      getEditorView: () => null,
      getActiveFilePath: () => props.store.activeFilePath(),
    });
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const list = filteredCommands();
    if (e.key === "Escape" || (e.ctrlKey && e.key === "g")) {
      e.preventDefault();
      props.store.setCommandPaletteOpen(false);
      props.store.focusEditor();
    } else if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
      e.preventDefault();
      if (list.length > 0) setActiveIndex((i) => (i + 1) % list.length);
    } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
      e.preventDefault();
      if (list.length > 0) setActiveIndex((i) => (i - 1 + list.length) % list.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = list[activeIndex()];
      if (cmd) void execute(cmd);
    }
  };

  return (
    <Show when={props.store.commandPaletteOpen()}>
      <div
        class="nib-modal-backdrop"
        onClick={(e) => {
          if (e.target === e.currentTarget) props.store.setCommandPaletteOpen(false);
        }}
      >
        <div
          class="nib-palette"
          role="dialog"
          aria-label="Command Palette"
          onKeyDown={handleKeyDown}
        >
          <div class="nib-palette-input-row">
            <span class="nib-palette-prompt">&gt;</span>
            <input
              ref={inputRef}
              class="nib-palette-input"
              type="text"
              placeholder="Run any command..."
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
            />
          </div>

          <div class="nib-palette-list">
            <Show
              when={filteredCommands().length > 0}
              fallback={<div class="nib-palette-empty">No matching commands.</div>}
            >
              <For each={filteredCommands()}>
                {(cmd, idx) => {
                  const binding = () => props.store.config().keybindings[cmd.id] ?? "";
                  return (
                    <div
                      class={`nib-palette-item ${idx() === activeIndex() ? "is-active" : ""}`}
                      onMouseEnter={() => setActiveIndex(idx())}
                      onClick={() => void execute(cmd)}
                    >
                      <div class="nib-palette-item-top">
                        <span class="nib-palette-title">
                          <Show when={cmd.category}>
                            <span class="nib-cmd-cat">{cmd.category}: </span>
                          </Show>
                          {cmd.title}
                        </span>
                        <Show when={binding()}>
                          <span class="nib-kbd-badge">{binding()}</span>
                        </Show>
                      </div>
                    </div>
                  );
                }}
              </For>
            </Show>
          </div>

          <div class="nib-palette-footer">
            <span>Every keybinding is also runnable as a command</span>
            <span>Enter: run · Esc: close</span>
          </div>
        </div>
      </div>
    </Show>
  );
}
