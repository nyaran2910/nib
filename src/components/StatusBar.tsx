import { Layers } from "lucide-solid";
import { For, createMemo, createSignal, onCleanup } from "solid-js";
import { pluginRegistry } from "../plugins/registry";
import type { WindowStore } from "../state/store";

export function StatusBar(props: { store: WindowStore }) {
  const [pluginVer, setPluginVer] = createSignal(0);
  const unsub = pluginRegistry.onChange(() => setPluginVer((v) => v + 1));
  onCleanup(unsub);

  const leftPluginItems = createMemo(() => {
    pluginVer();
    return pluginRegistry.getStatusBarItems().filter((i) => i.align !== "right");
  });

  const rightPluginItems = createMemo(() => {
    pluginVer();
    return pluginRegistry.getStatusBarItems().filter((i) => i.align === "right");
  });

  const modeClass = () => {
    if (!props.store.config().editor.vim_mode) return "nib-mode-badge";
    const m = props.store.vimMode();
    if (m === "INSERT") return "nib-mode-badge mode-insert";
    if (m === "VISUAL" || m === "V-LINE" || m === "V-BLOCK") return "nib-mode-badge mode-visual";
    return "nib-mode-badge";
  };

  const modeLabel = () =>
    props.store.config().editor.vim_mode ? props.store.vimMode() : "STANDARD";

  return (
    <footer class="nib-statusbar">
      <div class="nib-status-group">
        <button
          class="nib-status-session-btn"
          title="Sessions"
          onClick={() => props.store.openSessionModal()}
        >
          <Layers size={11} />
          <span>{props.store.currentSessionName()}</span>
        </button>
        <span class={modeClass()}>{modeLabel()}</span>
        <span>
          Ln {props.store.cursor().line}, Col {props.store.cursor().col}
        </span>
        <For each={leftPluginItems()}>
          {(item) => (
            <span
              class={item.onClick ? "nib-status-plugin-btn" : ""}
              title={item.title}
              onClick={() => item.onClick?.()}
            >
              {item.text}
            </span>
          )}
        </For>
      </div>
      <div class="nib-status-group">
        <For each={rightPluginItems()}>
          {(item) => (
            <span
              class={item.onClick ? "nib-status-plugin-btn" : ""}
              title={item.title}
              onClick={() => item.onClick?.()}
            >
              {item.text}
            </span>
          )}
        </For>
        <span>{props.store.cursor().words} words</span>
        <span>{props.store.cursor().chars} chars</span>
      </div>
    </footer>
  );
}
