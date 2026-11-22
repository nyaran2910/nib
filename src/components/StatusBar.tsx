import type { WindowStore } from "../state/store";

export function StatusBar(props: { store: WindowStore }) {
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
        <span class={modeClass()}>{modeLabel()}</span>
        <span>
          Ln {props.store.cursor().line}, Col {props.store.cursor().col}
        </span>
      </div>
      <div class="nib-status-group">
        <span>{props.store.cursor().words} words</span>
        <span>{props.store.cursor().chars} chars</span>
      </div>
    </footer>
  );
}
