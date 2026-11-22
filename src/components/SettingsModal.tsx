import {
  Code2,
  FolderTree,
  Image as ImageIcon,
  Keyboard,
  Layout,
  Search,
  Sliders,
  X,
} from "lucide-solid";
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { pluginRegistry } from "../plugins/registry";
import { suggestDirectories, type AppConfig } from "../state/ipc";
import type { WindowStore } from "../state/store";

type SectionId = "general" | "ui" | "editor" | "explorer" | "storage" | "hotkeys";

const SECTIONS: Array<{ id: SectionId; label: string; keywords: string }> = [
  { id: "general", label: "General", keywords: "general theme light dark system startup empty last tab directory panel resize step" },
  { id: "ui", label: "UI", keywords: "ui tabbar topbar statusbar sidebar search render vim window settings visibility" },
  { id: "editor", label: "Editor", keywords: "editor vim render rich minimal raw frontmatter properties font size line numbers relative absolute width centered full auto save" },
  { id: "explorer", label: "Containers", keywords: "containers explorer properties keymap vim emacs standard" },
  { id: "storage", label: "Images", keywords: "image storage folder webp quality cloudflare r2 bucket key trash" },
  { id: "hotkeys", label: "Hotkeys", keywords: "keybinding hotkey shortcut command" },
];

export function SettingsModal(props: { store: WindowStore }) {
  let searchInputRef: HTMLInputElement | undefined;
  let bodyRef: HTMLDivElement | undefined;

  const [draft, setDraft] = createSignal<AppConfig>(structuredClone(props.store.config()));
  const [activeSection, setActiveSection] = createSignal<SectionId>("general");
  const [search, setSearch] = createSignal("");
  const [pane, setPane] = createSignal<"nav" | "items">("nav");
  const [focusedRowIdx, setFocusedRowIdx] = createSignal(0);

  // Directory autocomplete state
  const [dirSuggestions, setDirSuggestions] = createSignal<string[]>([]);
  const [dirDropdownOpen, setDirDropdownOpen] = createSignal(false);
  const [dirSelectedIdx, setDirSelectedIdx] = createSignal(0);

  const [r2AccessKey, setR2AccessKey] = createSignal("");
  const [r2SecretKey, setR2SecretKey] = createSignal("");
  const [credMessage, setCredMessage] = createSignal<string | null>(null);
  const [cmdVersion, setCmdVersion] = createSignal(0);

  const unsub = pluginRegistry.onChange(() => setCmdVersion((v) => v + 1));
  onCleanup(unsub);

  createEffect(() => {
    if (props.store.settingsOpen()) {
      setDraft(structuredClone(props.store.config()));
      setSearch("");
      setPane("nav");
      setFocusedRowIdx(0);
      setDirDropdownOpen(false);
      setR2AccessKey("");
      setR2SecretKey("");
      setCredMessage(null);
      void props.store.refreshR2CredsStatus();
      void props.store.refreshTrashCount();
      queueMicrotask(() => searchInputRef?.focus());
    }
  });

  const qLower = () => search().trim().toLowerCase();
  const isSearching = () => qLower().length > 0;
  const rowMatches = (text: string) => isSearching() && text.toLowerCase().includes(qLower());

  const matchingSections = createMemo(() => {
    const q = qLower();
    if (!q) return SECTIONS;
    return SECTIONS.filter((s) => {
      if (s.label.toLowerCase().includes(q) || s.keywords.includes(q)) return true;
      if (s.id === "hotkeys") {
        return pluginRegistry
          .getCommands()
          .some((c) => `${c.title} ${c.id} ${draft().keybindings[c.id] ?? ""}`.toLowerCase().includes(q));
      }
      return false;
    });
  });

  createEffect(() => {
    const list = matchingSections();
    if (list.length > 0 && !list.some((s) => s.id === activeSection())) {
      setActiveSection(list[0].id);
    }
  });

  const filteredCommands = createMemo(() => {
    cmdVersion();
    const q = qLower();
    return pluginRegistry.getCommands().filter((cmd) => {
      if (!q) return true;
      const binding = draft().keybindings[cmd.id] ?? "";
      return `${cmd.category ?? ""} ${cmd.title} ${cmd.id} ${binding}`.toLowerCase().includes(q);
    });
  });

  const showSection = (id: SectionId) =>
    isSearching() ? matchingSections().some((s) => s.id === id) : activeSection() === id;

  const getSettingRows = (): HTMLElement[] => {
    if (!bodyRef) return [];
    return Array.from(bodyRef.querySelectorAll<HTMLElement>("[data-setting-row]"));
  };

  // Highlight focused row visually & scroll into view when in `items` pane
  createEffect(() => {
    const inItems = pane() === "items";
    const idx = focusedRowIdx();
    activeSection();
    search();
    queueMicrotask(() => {
      const rows = getSettingRows();
      rows.forEach((el, i) => {
        if (inItems && i === idx) {
          el.classList.add("is-kb-focus");
          el.scrollIntoView({ block: "nearest" });
        } else {
          el.classList.remove("is-kb-focus");
        }
      });
    });
  });

  // Auto-scroll first search match into view while typing in search
  createEffect(() => {
    if (!isSearching()) return;
    search();
    queueMicrotask(() => {
      const firstMatch = bodyRef?.querySelector<HTMLElement>(".is-search-match");
      firstMatch?.scrollIntoView({ block: "nearest" });
    });
  });

  const updateDirSuggestions = async (val: string) => {
    const list = await suggestDirectories(val);
    setDirSuggestions(list);
    setDirSelectedIdx(0);
    setDirDropdownOpen(list.length > 0);
  };

  const applyDirSuggestion = (dir: string) => {
    setDraft((p) => ({ ...p, default_directory: dir }));
    void updateDirSuggestions(dir);
  };

  const handleSave = async () => {
    await props.store.updateConfig(draft());
    if (r2AccessKey().trim() || r2SecretKey().trim()) {
      await props.store.saveR2Creds(r2AccessKey().trim() || null, r2SecretKey().trim() || null);
    }
    props.store.setSettingsOpen(false);
    props.store.focusEditor();
  };

  const handleSaveCredsOnly = async () => {
    await props.store.saveR2Creds(r2AccessKey().trim() || null, r2SecretKey().trim() || null);
    setR2AccessKey("");
    setR2SecretKey("");
    setCredMessage("Saved locally");
  };

  const handleClearCreds = async () => {
    await props.store.clearR2Creds();
    setCredMessage("Cleared");
  };

  const updateKeybinding = (action: string, value: string) => {
    setDraft((prev) => ({
      ...prev,
      keybindings: { ...prev.keybindings, [action]: value },
    }));
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const activeEl = document.activeElement as HTMLElement | null;
    const inSearch = activeEl === searchInputRef;
    const inRowControl = Boolean(
      activeEl &&
        !inSearch &&
        (activeEl.tagName === "INPUT" || activeEl.tagName === "SELECT"),
    );

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      e.stopPropagation();
      void handleSave();
      return;
    }

    // If typing inside a setting row's input/select, Esc returns to row-focus mode
    if (inRowControl) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setDirDropdownOpen(false);
        activeEl?.blur();
        bodyRef?.focus();
      }
      return;
    }

    // Ctrl+L moves focus into Right Pane setting items
    if (pane() === "nav" && e.ctrlKey && e.key === "l") {
      e.preventDefault();
      const rows = getSettingRows();
      if (rows.length > 0) {
        const matchIdx = rows.findIndex((r) => r.classList.contains("is-search-match"));
        setFocusedRowIdx(matchIdx >= 0 ? matchIdx : 0);
        setPane("items");
        searchInputRef?.blur();
        bodyRef?.focus();
      }
      return;
    }

    if (pane() === "nav") {
      if (e.key === "Escape") {
        e.preventDefault();
        if (search().length > 0) {
          setSearch("");
        } else {
          props.store.setSettingsOpen(false);
          props.store.focusEditor();
        }
        return;
      }
      const list = matchingSections();
      if (list.length === 0) return;
      if ((e.ctrlKey && e.key === "n") || e.key === "ArrowDown") {
        e.preventDefault();
        const idx = list.findIndex((s) => s.id === activeSection());
        setActiveSection(list[(idx + 1) % list.length].id);
      } else if ((e.ctrlKey && e.key === "p") || e.key === "ArrowUp") {
        e.preventDefault();
        const idx = list.findIndex((s) => s.id === activeSection());
        setActiveSection(list[(idx - 1 + list.length) % list.length].id);
      }
      return;
    }

    // Inside Right Pane (`items` keyboard mode)
    const rows = getSettingRows();
    if (e.key === "Escape" || (e.ctrlKey && e.key === "h")) {
      e.preventDefault();
      setPane("nav");
      searchInputRef?.focus();
      return;
    }
    if (rows.length === 0) return;

    if ((e.ctrlKey && e.key === "n") || e.key === "ArrowDown" || (!e.ctrlKey && e.key === "j")) {
      e.preventDefault();
      setFocusedRowIdx((i) => (i + 1) % rows.length);
      return;
    }
    if ((e.ctrlKey && e.key === "p") || e.key === "ArrowUp" || (!e.ctrlKey && e.key === "k")) {
      e.preventDefault();
      setFocusedRowIdx((i) => (i - 1 + rows.length) % rows.length);
      return;
    }

    const row = rows[focusedRowIdx()];
    if (!row) return;

    // Space toggles checkbox, cycles select, or triggers button
    if (e.key === " ") {
      e.preventDefault();
      const cb = row.querySelector<HTMLInputElement>('input[type="checkbox"]');
      if (cb) {
        cb.click();
        return;
      }
      const sel = row.querySelector<HTMLSelectElement>("select");
      if (sel && sel.options.length > 0) {
        sel.selectedIndex = (sel.selectedIndex + 1) % sel.options.length;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        return;
      }
      const btn = row.querySelector<HTMLButtonElement>("button");
      if (btn) btn.click();
      return;
    }

    // Enter enters text/number/select input or toggles checkbox
    if (e.key === "Enter") {
      e.preventDefault();
      const textInput = row.querySelector<HTMLInputElement>(
        'input:not([type="checkbox"])',
      );
      if (textInput) {
        textInput.focus();
        textInput.select();
        return;
      }
      const sel = row.querySelector<HTMLSelectElement>("select");
      if (sel) {
        sel.focus();
        return;
      }
      const cb = row.querySelector<HTMLInputElement>('input[type="checkbox"]');
      if (cb) {
        cb.click();
        return;
      }
      const btn = row.querySelector<HTMLButtonElement>("button");
      if (btn) btn.click();
    }
  };

  const renderSectionIcon = (id: SectionId) => {
    switch (id) {
      case "general":
        return <Sliders size={14} />;
      case "ui":
        return <Layout size={14} />;
      case "editor":
        return <Code2 size={14} />;
      case "explorer":
        return <FolderTree size={14} />;
      case "storage":
        return <ImageIcon size={14} />;
      case "hotkeys":
        return <Keyboard size={14} />;
    }
  };

  return (
    <Show when={props.store.settingsOpen()}>
      <div
        class="nib-modal-backdrop"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            props.store.setSettingsOpen(false);
            props.store.focusEditor();
          }
        }}
      >
        <div
          class="nib-settings-window"
          role="dialog"
          aria-label="Settings"
          onKeyDown={handleKeyDown}
        >
          <aside class="nib-settings-nav">
            <div class="nib-settings-nav-search">
              <Search size={13} class="nib-settings-search-ico" />
              <input
                ref={searchInputRef}
                class="nib-settings-nav-input"
                type="text"
                placeholder="Search…"
                value={search()}
                onFocus={() => setPane("nav")}
                onInput={(e) => setSearch(e.currentTarget.value)}
              />
            </div>

            <nav class="nib-settings-nav-list">
              <For each={matchingSections()}>
                {(sec) => (
                  <button
                    class={`nib-settings-nav-item ${activeSection() === sec.id ? "is-active" : ""}`}
                    onClick={() => {
                      setSearch("");
                      setActiveSection(sec.id);
                      setPane("nav");
                    }}
                  >
                    {renderSectionIcon(sec.id)}
                    <span>{sec.label}</span>
                  </button>
                )}
              </For>
            </nav>
          </aside>

          <div class="nib-settings-content">
            <div class="nib-modal-header">
              <span>
                {isSearching()
                  ? `Search`
                  : SECTIONS.find((s) => s.id === activeSection())?.label}
              </span>
              <button
                class="nib-icon-btn"
                onClick={() => {
                  props.store.setSettingsOpen(false);
                  props.store.focusEditor();
                }}
              >
                <X size={15} />
              </button>
            </div>

            <div class="nib-modal-body" ref={bodyRef} tabIndex={-1}>
              <Show when={showSection("general")}>
                <section class="nib-settings-section">
                  <div
                    data-setting-row
                    class={`nib-setting-row ${rowMatches("theme light dark system") ? "is-search-match" : ""}`}
                  >
                    <span>Theme</span>
                    <select
                      class="nib-input"
                      value={draft().appearance.theme}
                      onChange={(e) =>
                        setDraft((p) => ({
                          ...p,
                          appearance: { ...p.appearance, theme: e.currentTarget.value },
                        }))
                      }
                    >
                      <option value="system">System</option>
                      <option value="light">Light</option>
                      <option value="dark">Dark</option>
                    </select>
                  </div>

                  <div
                    data-setting-row
                    class={`nib-setting-row ${rowMatches("startup empty tab last note open") ? "is-search-match" : ""}`}
                  >
                    <span>On startup</span>
                    <select
                      class="nib-input"
                      value={draft().startup_behavior}
                      onChange={(e) =>
                        setDraft((p) => ({ ...p, startup_behavior: e.currentTarget.value }))
                      }
                    >
                      <option value="empty">Empty tab</option>
                      <option value="last_note">Last opened note</option>
                    </select>
                  </div>

                  <div
                    data-setting-row
                    class={`nib-setting-row ${rowMatches("default directory startup folder path") ? "is-search-match" : ""}`}
                  >
                    <span>Default directory</span>
                    <div class="nib-dir-autocomplete">
                      <input
                        class="nib-input"
                        type="text"
                        placeholder="~/Notes"
                        style={{ width: "240px" }}
                        value={draft().default_directory ?? ""}
                        onFocus={(e) => void updateDirSuggestions(e.currentTarget.value)}
                        onBlur={() => window.setTimeout(() => setDirDropdownOpen(false), 140)}
                        onInput={(e) => {
                          const v = e.currentTarget.value;
                          setDraft((p) => ({ ...p, default_directory: v.trim() || null }));
                          void updateDirSuggestions(v);
                        }}
                        onKeyDown={(e) => {
                          const list = dirSuggestions();
                          if (!dirDropdownOpen() || list.length === 0) return;
                          if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
                            e.preventDefault();
                            e.stopPropagation();
                            setDirSelectedIdx((i) => (i + 1) % list.length);
                          } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
                            e.preventDefault();
                            e.stopPropagation();
                            setDirSelectedIdx((i) => (i - 1 + list.length) % list.length);
                          } else if (e.key === "Enter" || e.key === "Tab") {
                            e.preventDefault();
                            e.stopPropagation();
                            const chosen = list[dirSelectedIdx()];
                            if (chosen) applyDirSuggestion(chosen);
                          }
                        }}
                      />
                      <Show when={dirDropdownOpen() && dirSuggestions().length > 0}>
                        <div class="nib-dir-dropdown">
                          <For each={dirSuggestions()}>
                            {(dir, idx) => (
                              <div
                                class={`nib-dir-option ${idx() === dirSelectedIdx() ? "is-active" : ""}`}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  applyDirSuggestion(dir);
                                }}
                              >
                                {dir}
                              </div>
                            )}
                          </For>
                        </div>
                      </Show>
                    </div>
                  </div>

                  <div
                    data-setting-row
                    class={`nib-setting-row ${rowMatches("panel resize step px") ? "is-search-match" : ""}`}
                  >
                    <span>Panel resize step (px)</span>
                    <input
                      class="nib-input"
                      type="number"
                      min="1"
                      max="200"
                      style={{ width: "86px" }}
                      value={draft().appearance.panel_resize_step}
                      onInput={(e) =>
                        setDraft((p) => ({
                          ...p,
                          appearance: {
                            ...p.appearance,
                            panel_resize_step: Math.max(1, Number(e.currentTarget.value) || 5),
                          },
                        }))
                      }
                    />
                  </div>
                </section>
              </Show>

              <Show when={showSection("ui")}>
                <section class="nib-settings-section">
                  <div
                    data-setting-row
                    class={`nib-setting-row ${rowMatches("tab bar topbar") ? "is-search-match" : ""}`}
                  >
                    <span>Tab bar</span>
                    <input
                      type="checkbox"
                      checked={draft().ui.show_topbar}
                      onChange={(e) =>
                        setDraft((p) => ({
                          ...p,
                          ui: { ...p.ui, show_topbar: e.currentTarget.checked },
                        }))
                      }
                    />
                  </div>
                  <div
                    data-setting-row
                    class={`nib-setting-row ${rowMatches("status bar") ? "is-search-match" : ""}`}
                  >
                    <span>Status bar</span>
                    <input
                      type="checkbox"
                      checked={draft().ui.show_statusbar}
                      onChange={(e) =>
                        setDraft((p) => ({
                          ...p,
                          ui: { ...p.ui, show_statusbar: e.currentTarget.checked },
                        }))
                      }
                    />
                  </div>
                  <div
                    data-setting-row
                    class={`nib-setting-row ${rowMatches("sidebar search") ? "is-search-match" : ""}`}
                  >
                    <span>Sidebar search</span>
                    <input
                      type="checkbox"
                      checked={draft().ui.show_sidebar_search}
                      onChange={(e) =>
                        setDraft((p) => ({
                          ...p,
                          ui: { ...p.ui, show_sidebar_search: e.currentTarget.checked },
                        }))
                      }
                    />
                  </div>
                  <div
                    data-setting-row
                    class={`nib-setting-row ${rowMatches("search button") ? "is-search-match" : ""}`}
                  >
                    <span>Search button</span>
                    <input
                      type="checkbox"
                      checked={draft().ui.show_topbar_search}
                      onChange={(e) =>
                        setDraft((p) => ({
                          ...p,
                          ui: { ...p.ui, show_topbar_search: e.currentTarget.checked },
                        }))
                      }
                    />
                  </div>
                  <div
                    data-setting-row
                    class={`nib-setting-row ${rowMatches("render toggle") ? "is-search-match" : ""}`}
                  >
                    <span>Render button</span>
                    <input
                      type="checkbox"
                      checked={draft().ui.show_topbar_render_toggle}
                      onChange={(e) =>
                        setDraft((p) => ({
                          ...p,
                          ui: { ...p.ui, show_topbar_render_toggle: e.currentTarget.checked },
                        }))
                      }
                    />
                  </div>
                  <div
                    data-setting-row
                    class={`nib-setting-row ${rowMatches("vim toggle button") ? "is-search-match" : ""}`}
                  >
                    <span>Vim button</span>
                    <input
                      type="checkbox"
                      checked={draft().ui.show_topbar_vim_toggle}
                      onChange={(e) =>
                        setDraft((p) => ({
                          ...p,
                          ui: { ...p.ui, show_topbar_vim_toggle: e.currentTarget.checked },
                        }))
                      }
                    />
                  </div>
                  <div
                    data-setting-row
                    class={`nib-setting-row ${rowMatches("command palette button") ? "is-search-match" : ""}`}
                  >
                    <span>Command palette button</span>
                    <input
                      type="checkbox"
                      checked={draft().ui.show_topbar_command_palette}
                      onChange={(e) =>
                        setDraft((p) => ({
                          ...p,
                          ui: { ...p.ui, show_topbar_command_palette: e.currentTarget.checked },
                        }))
                      }
                    />
                  </div>
                  <div
                    data-setting-row
                    class={`nib-setting-row ${rowMatches("new window button") ? "is-search-match" : ""}`}
                  >
                    <span>New window button</span>
                    <input
                      type="checkbox"
                      checked={draft().ui.show_topbar_new_window}
                      onChange={(e) =>
                        setDraft((p) => ({
                          ...p,
                          ui: { ...p.ui, show_topbar_new_window: e.currentTarget.checked },
                        }))
                      }
                    />
                  </div>
                  <div
                    data-setting-row
                    class={`nib-setting-row ${rowMatches("settings button") ? "is-search-match" : ""}`}
                  >
                    <span>Settings button</span>
                    <input
                      type="checkbox"
                      checked={draft().ui.show_topbar_settings}
                      onChange={(e) =>
                        setDraft((p) => ({
                          ...p,
                          ui: { ...p.ui, show_topbar_settings: e.currentTarget.checked },
                        }))
                      }
                    />
                  </div>
                </section>
              </Show>

              <Show when={showSection("editor")}>
                <section class="nib-settings-section">
                  <div
                    data-setting-row
                    class={`nib-setting-row ${rowMatches("render mode rich minimal raw markdown") ? "is-search-match" : ""}`}
                  >
                    <span>Render mode</span>
                    <select
                      class="nib-input"
                      value={draft().editor.render_mode}
                      onChange={(e) =>
                        setDraft((p) => ({
                          ...p,
                          editor: { ...p.editor, render_mode: e.currentTarget.value },
                        }))
                      }
                    >
                      <option value="rich">Rich</option>
                      <option value="minimal">Minimal</option>
                      <option value="raw">Raw</option>
                    </select>
                  </div>
                  <div
                    data-setting-row
                    class={`nib-setting-row ${rowMatches("editor width centered full page") ? "is-search-match" : ""}`}
                  >
                    <span>Editor width</span>
                    <select
                      class="nib-input"
                      value={draft().editor.editor_width}
                      onChange={(e) =>
                        setDraft((p) => ({
                          ...p,
                          editor: { ...p.editor, editor_width: e.currentTarget.value },
                        }))
                      }
                    >
                      <option value="centered">Centered</option>
                      <option value="full">Full width</option>
                    </select>
                  </div>
                  <div
                    data-setting-row
                    class={`nib-setting-row ${rowMatches("line numbers relative absolute off") ? "is-search-match" : ""}`}
                  >
                    <span>Line numbers</span>
                    <select
                      class="nib-input"
                      value={draft().editor.line_number_mode}
                      onChange={(e) =>
                        setDraft((p) => ({
                          ...p,
                          editor: { ...p.editor, line_number_mode: e.currentTarget.value },
                        }))
                      }
                    >
                      <option value="relative">Relative</option>
                      <option value="absolute">Absolute</option>
                      <option value="off">Off</option>
                    </select>
                  </div>
                  <div
                    data-setting-row
                    class={`nib-setting-row ${rowMatches("vim mode") ? "is-search-match" : ""}`}
                  >
                    <span>Vim mode</span>
                    <input
                      type="checkbox"
                      checked={draft().editor.vim_mode}
                      onChange={(e) =>
                        setDraft((p) => ({
                          ...p,
                          editor: { ...p.editor, vim_mode: e.currentTarget.checked },
                        }))
                      }
                    />
                  </div>
                  <div
                    data-setting-row
                    class={`nib-setting-row ${rowMatches("font size") ? "is-search-match" : ""}`}
                  >
                    <span>Font size</span>
                    <input
                      class="nib-input"
                      type="number"
                      min="12"
                      max="28"
                      style={{ width: "86px" }}
                      value={draft().editor.font_size}
                      onInput={(e) =>
                        setDraft((p) => ({
                          ...p,
                          editor: { ...p.editor, font_size: Number(e.currentTarget.value) || 16 },
                        }))
                      }
                    />
                  </div>
                  <div
                    data-setting-row
                    class={`nib-setting-row ${rowMatches("frontmatter properties editor") ? "is-search-match" : ""}`}
                  >
                    <span>Show frontmatter in editor</span>
                    <input
                      type="checkbox"
                      checked={draft().editor.show_frontmatter_in_editor}
                      onChange={(e) =>
                        setDraft((p) => ({
                          ...p,
                          editor: { ...p.editor, show_frontmatter_in_editor: e.currentTarget.checked },
                        }))
                      }
                    />
                  </div>
                  <div
                    data-setting-row
                    class={`nib-setting-row ${rowMatches("auto save delay") ? "is-search-match" : ""}`}
                  >
                    <span>Auto-save (ms)</span>
                    <input
                      class="nib-input"
                      type="number"
                      min="0"
                      max="10000"
                      step="200"
                      style={{ width: "86px" }}
                      value={draft().editor.auto_save_ms}
                      onInput={(e) =>
                        setDraft((p) => ({
                          ...p,
                          editor: {
                            ...p.editor,
                            auto_save_ms: Math.max(0, Number(e.currentTarget.value) || 0),
                          },
                        }))
                      }
                    />
                  </div>
                </section>
              </Show>

              <Show when={showSection("explorer")}>
                <section class="nib-settings-section">
                  <div
                    data-setting-row
                    class={`nib-setting-row ${rowMatches("explorer keymap vim emacs standard") ? "is-search-match" : ""}`}
                  >
                    <span>Explorer keymap</span>
                    <select
                      class="nib-input"
                      value={draft().explorer.keymap_mode}
                      onChange={(e) =>
                        setDraft((p) => ({
                          ...p,
                          explorer: { ...p.explorer, keymap_mode: e.currentTarget.value },
                        }))
                      }
                    >
                      <option value="vim">Vim</option>
                      <option value="emacs">Emacs</option>
                      <option value="standard">Standard</option>
                    </select>
                  </div>
                  <div
                    data-setting-row
                    class={`nib-setting-row ${rowMatches("properties keymap vim standard") ? "is-search-match" : ""}`}
                  >
                    <span>Properties keymap</span>
                    <select
                      class="nib-input"
                      value={draft().properties.keymap_mode}
                      onChange={(e) =>
                        setDraft((p) => ({
                          ...p,
                          properties: { ...p.properties, keymap_mode: e.currentTarget.value },
                        }))
                      }
                    >
                      <option value="vim">Vim</option>
                      <option value="standard">Standard</option>
                    </select>
                  </div>
                </section>
              </Show>

              <Show when={showSection("storage")}>
                <section class="nib-settings-section">
                  <div
                    data-setting-row
                    class={`nib-setting-row ${rowMatches("storage destination local folder cloudflare r2") ? "is-search-match" : ""}`}
                  >
                    <span>Storage</span>
                    <select
                      class="nib-input"
                      value={draft().storage.provider}
                      onChange={(e) =>
                        setDraft((p) => ({
                          ...p,
                          storage: { ...p.storage, provider: e.currentTarget.value },
                        }))
                      }
                    >
                      <option value="local_folder">Local folder</option>
                      <option value="r2">Cloudflare R2</option>
                    </select>
                  </div>

                  <Show when={draft().storage.provider === "local_folder"}>
                    <div
                      data-setting-row
                      class={`nib-setting-row ${rowMatches("images folder subfolder") ? "is-search-match" : ""}`}
                    >
                      <span>Images folder</span>
                      <input
                        class="nib-input"
                        type="text"
                        placeholder="images"
                        style={{ width: "160px" }}
                        value={draft().storage.local_images_dir}
                        onInput={(e) =>
                          setDraft((p) => ({
                            ...p,
                            storage: {
                              ...p.storage,
                              local_images_dir: e.currentTarget.value.trim() || "images",
                            },
                          }))
                        }
                      />
                    </div>
                  </Show>

                  <div
                    data-setting-row
                    class={`nib-setting-row ${rowMatches("webp convert") ? "is-search-match" : ""}`}
                  >
                    <span>WebP conversion</span>
                    <input
                      type="checkbox"
                      checked={draft().storage.auto_convert_webp}
                      onChange={(e) =>
                        setDraft((p) => ({
                          ...p,
                          storage: { ...p.storage, auto_convert_webp: e.currentTarget.checked },
                        }))
                      }
                    />
                  </div>

                  <Show when={draft().storage.auto_convert_webp}>
                    <div
                      data-setting-row
                      class={`nib-setting-row ${rowMatches("webp quality") ? "is-search-match" : ""}`}
                    >
                      <span>WebP quality</span>
                      <input
                        class="nib-input"
                        type="number"
                        min="10"
                        max="100"
                        style={{ width: "86px" }}
                        value={draft().storage.webp_quality}
                        onInput={(e) =>
                          setDraft((p) => ({
                            ...p,
                            storage: {
                              ...p.storage,
                              webp_quality: Math.min(
                                100,
                                Math.max(10, Number(e.currentTarget.value) || 82),
                              ),
                            },
                          }))
                        }
                      />
                    </div>
                  </Show>

                  <Show when={draft().storage.provider === "r2"}>
                    <div class="nib-r2-panel">
                      <div
                        data-setting-row
                        class={`nib-setting-row ${rowMatches("r2 account id cloudflare") ? "is-search-match" : ""}`}
                      >
                        <span>Account ID</span>
                        <input
                          class="nib-input"
                          type="text"
                          style={{ width: "220px" }}
                          value={draft().storage.r2_account_id ?? ""}
                          onInput={(e) =>
                            setDraft((p) => ({
                              ...p,
                              storage: {
                                ...p.storage,
                                r2_account_id: e.currentTarget.value.trim() || null,
                              },
                            }))
                          }
                        />
                      </div>

                      <div
                        data-setting-row
                        class={`nib-setting-row ${rowMatches("r2 bucket cloudflare") ? "is-search-match" : ""}`}
                      >
                        <span>Bucket</span>
                        <input
                          class="nib-input"
                          type="text"
                          style={{ width: "220px" }}
                          value={draft().storage.r2_bucket ?? ""}
                          onInput={(e) =>
                            setDraft((p) => ({
                              ...p,
                              storage: {
                                ...p.storage,
                                r2_bucket: e.currentTarget.value.trim() || null,
                              },
                            }))
                          }
                        />
                      </div>

                      <div
                        data-setting-row
                        class={`nib-setting-row ${rowMatches("r2 public url cloudflare") ? "is-search-match" : ""}`}
                      >
                        <span>Public URL</span>
                        <input
                          class="nib-input"
                          type="url"
                          placeholder="https://..."
                          style={{ width: "220px" }}
                          value={draft().storage.r2_public_base_url ?? ""}
                          onInput={(e) =>
                            setDraft((p) => ({
                              ...p,
                              storage: {
                                ...p.storage,
                                r2_public_base_url: e.currentTarget.value.trim() || null,
                              },
                            }))
                          }
                        />
                      </div>

                      <div
                        data-setting-row
                        class={`nib-setting-row ${rowMatches("r2 access key id cloudflare") ? "is-search-match" : ""}`}
                      >
                        <span>Access Key ID</span>
                        <input
                          class="nib-input"
                          type="password"
                          placeholder={
                            props.store.r2CredsStatus().has_access_key_id
                              ? props.store.r2CredsStatus().access_key_id_preview ?? "Stored"
                              : ""
                          }
                          style={{ width: "220px" }}
                          value={r2AccessKey()}
                          onInput={(e) => setR2AccessKey(e.currentTarget.value)}
                        />
                      </div>

                      <div
                        data-setting-row
                        class={`nib-setting-row ${rowMatches("r2 secret access key cloudflare") ? "is-search-match" : ""}`}
                      >
                        <span>Secret Key</span>
                        <input
                          class="nib-input"
                          type="password"
                          placeholder={
                            props.store.r2CredsStatus().has_secret_access_key ? "Stored" : ""
                          }
                          style={{ width: "220px" }}
                          value={r2SecretKey()}
                          onInput={(e) => setR2SecretKey(e.currentTarget.value)}
                        />
                      </div>

                      <div class="nib-setting-row">
                        <span class="nib-setting-hint">{credMessage() ?? ""}</span>
                        <div style={{ display: "flex", gap: "8px" }}>
                          <button class="nib-secondary-btn" onClick={() => void handleClearCreds()}>
                            Clear
                          </button>
                          <button
                            class="nib-secondary-btn"
                            onClick={() => void handleSaveCredsOnly()}
                          >
                            Save Keys
                          </button>
                        </div>
                      </div>
                    </div>
                  </Show>

                  <div
                    data-setting-row
                    class={`nib-setting-row ${rowMatches("trash purge image") ? "is-search-match" : ""}`}
                  >
                    <span>Trash ({props.store.trashedCount()})</span>
                    <button
                      class="nib-secondary-btn"
                      onClick={() => void props.store.purgeTrash()}
                    >
                      Purge
                    </button>
                  </div>
                </section>
              </Show>

              <Show when={showSection("hotkeys")}>
                <section class="nib-settings-section">
                  <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
                    <For each={filteredCommands()}>
                      {(cmd) => (
                        <div
                          data-setting-row
                          class={`nib-setting-row ${rowMatches(`${cmd.title} ${cmd.id} ${draft().keybindings[cmd.id] ?? ""}`) ? "is-search-match" : ""}`}
                        >
                          <span>{cmd.title}</span>
                          <input
                            class="nib-input"
                            style={{ width: "144px" }}
                            placeholder="—"
                            value={draft().keybindings[cmd.id] ?? ""}
                            onInput={(e) => updateKeybinding(cmd.id, e.currentTarget.value)}
                          />
                        </div>
                      )}
                    </For>
                  </div>
                </section>
              </Show>
            </div>

            <div class="nib-modal-footer">
              <span class="nib-config-path" title={props.store.configPaths().global_config_file}>
                {props.store.configPaths().global_config_file}
              </span>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  class="nib-secondary-btn"
                  onClick={() => {
                    props.store.setSettingsOpen(false);
                    props.store.focusEditor();
                  }}
                >
                  Cancel
                </button>
                <button class="nib-primary-btn" onClick={() => void handleSave()}>
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
