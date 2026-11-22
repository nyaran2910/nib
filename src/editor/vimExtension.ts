import {
  cursorCharLeft,
  cursorCharRight,
  cursorLineDown,
  cursorLineEnd,
  cursorLineStart,
  cursorLineUp,
  deleteCharBackward,
  deleteCharForward,
  deleteGroupBackward,
  deleteToLineEnd,
  deleteToLineStart,
  splitLine,
  transposeChars,
} from "@codemirror/commands";
import { Prec, StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  keymap,
} from "@codemirror/view";
import {
  Vim,
  getCM,
  vim,
  type CM5RangeInterface,
  type CodeMirrorV,
  type OperatorArgs,
  type Pos,
} from "@replit/codemirror-vim";

export type VimModeLabel = "NORMAL" | "INSERT" | "VISUAL" | "V-LINE" | "V-BLOCK" | "REPLACE";

interface YankFlashRange {
  from: number;
  to: number;
}

const setYankFlashEffect = StateEffect.define<YankFlashRange[]>();
const clearYankFlashEffect = StateEffect.define<void>();

const yankFlashMark = Decoration.mark({ class: "cm-yank-flash" });

const yankFlashField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decos, tr) {
    let next = decos.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(clearYankFlashEffect)) {
        next = Decoration.none;
      } else if (effect.is(setYankFlashEffect)) {
        const ranges = effect.value
          .filter((r) => r.from < r.to)
          .sort((a, b) => a.from - b.from)
          .map((r) => yankFlashMark.range(r.from, r.to));
        next = Decoration.set(ranges, true);
      }
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

interface ViewYankConfig {
  durationMs: number;
  timer?: number;
  onSave?: () => void;
  onQuit?: () => void;
}

const viewConfigs = new WeakMap<EditorView, ViewYankConfig>();
let globalOperatorsRegistered = false;

function posToOffset(view: EditorView, pos: Pos): number {
  const lineNum = Math.min(Math.max(1, pos.line + 1), view.state.doc.lines);
  const line = view.state.doc.line(lineNum);
  const ch = Math.min(Math.max(0, pos.ch), line.length);
  return line.from + ch;
}

function triggerYankFlash(view: EditorView, ranges: YankFlashRange[]): void {
  const cfg = viewConfigs.get(view);
  const durationMs = cfg?.durationMs ?? 220;
  if (cfg?.timer !== undefined) {
    window.clearTimeout(cfg.timer);
  }
  view.dispatch({ effects: setYankFlashEffect.of(ranges) });
  const timer = window.setTimeout(() => {
    try {
      view.dispatch({ effects: clearYankFlashEffect.of(undefined) });
    } catch {
      // View may have been destroyed
    }
  }, durationMs);
  if (cfg) {
    cfg.timer = timer;
  }
}

function cursorMin(...positions: Array<Pos | undefined>): Pos {
  let best = positions.find((p): p is Pos => Boolean(p)) ?? { line: 0, ch: 0 };
  for (const p of positions) {
    if (!p) continue;
    if (p.line < best.line || (p.line === best.line && p.ch < best.ch)) {
      best = p;
    }
  }
  return best;
}

function registerGlobalVimEnhancements(): void {
  if (globalOperatorsRegistered) return;
  globalOperatorsRegistered = true;

  // Match upstream @replit/codemirror-vim-core yank semantics + add Neovim TextYankPost flash
  Vim.defineOperator(
    "yank",
    (cm: CodeMirrorV, args: OperatorArgs, ranges: CM5RangeInterface[], oldAnchor: Pos): Pos => {
      const view = cm.cm6 as EditorView;
      const vimState = cm.state.vim;
      const linewise = Boolean(args.linewise || args.fullLine || vimState?.visualLine);
      const doc = view.state.doc;

      const yankedText = cm.getSelection();
      const endPos = vimState?.visualMode
        ? cursorMin(vimState.sel?.anchor, vimState.sel?.head, ranges[0]?.head, ranges[0]?.anchor)
        : oldAnchor;

      const flashRanges: YankFlashRange[] = [];
      for (const r of ranges) {
        let from = posToOffset(view, r.anchor);
        let to = posToOffset(view, r.head);
        if (from > to) [from, to] = [to, from];

        if (linewise) {
          const startLine = doc.lineAt(from);
          const endLine = doc.lineAt(Math.max(from, to > from ? to - 1 : to));
          if (startLine.from < endLine.to) {
            flashRanges.push({ from: startLine.from, to: endLine.to });
          }
        } else {
          const end = Math.min(doc.length, to);
          if (from < end) {
            flashRanges.push({ from, to: end });
          }
        }
      }

      const regController = Vim.getRegisterController();
      regController.pushText(
        args.registerName ?? undefined,
        "yank",
        yankedText,
        args.linewise,
        Boolean(vimState?.visualBlock),
      );

      if (!args.registerName || args.registerName === "+" || args.registerName === "*") {
        navigator.clipboard?.writeText(yankedText).catch(() => {});
      }

      if (flashRanges.length > 0) {
        triggerYankFlash(view, flashRanges);
      }

      return endPos;
    },
  );

  Vim.defineEx("write", "w", (cm: CodeMirrorV) => {
    const view = cm.cm6 as EditorView;
    viewConfigs.get(view)?.onSave?.();
  });

  Vim.defineEx("quit", "q", (cm: CodeMirrorV) => {
    const view = cm.cm6 as EditorView;
    viewConfigs.get(view)?.onQuit?.();
  });

  Vim.defineEx("wq", "wq", (cm: CodeMirrorV) => {
    const view = cm.cm6 as EditorView;
    const cfg = viewConfigs.get(view);
    cfg?.onSave?.();
    cfg?.onQuit?.();
  });
}

function isInsertOrStandardMode(view: EditorView): boolean {
  const cm = getCM(view);
  if (!cm?.state?.vim) return true;
  return Boolean(cm.state.vim.insertMode);
}

function insertOnly(cmd: (view: EditorView) => boolean): (view: EditorView) => boolean {
  return (view) => {
    if (!isInsertOrStandardMode(view)) return false;
    return cmd(view);
  };
}

/**
 * Native macOS Emacs editing keys (Ctrl+H/D/A/E/F/B/N/P/K/U/W/O/T) active in Insert & Standard modes,
 * while passing straight through to Vim in NORMAL/VISUAL modes.
 */
export function createMacEmacsInsertKeymap(): Extension {
  return Prec.highest(
    keymap.of([
      { key: "Ctrl-h", run: insertOnly(deleteCharBackward) },
      { key: "Ctrl-d", run: insertOnly(deleteCharForward) },
      { key: "Ctrl-a", run: insertOnly(cursorLineStart) },
      { key: "Ctrl-e", run: insertOnly(cursorLineEnd) },
      { key: "Ctrl-f", run: insertOnly(cursorCharRight) },
      { key: "Ctrl-b", run: insertOnly(cursorCharLeft) },
      { key: "Ctrl-n", run: insertOnly(cursorLineDown) },
      { key: "Ctrl-p", run: insertOnly(cursorLineUp) },
      { key: "Ctrl-k", run: insertOnly(deleteToLineEnd) },
      { key: "Ctrl-u", run: insertOnly(deleteToLineStart) },
      { key: "Ctrl-w", run: insertOnly(deleteGroupBackward) },
      { key: "Ctrl-o", run: insertOnly(splitLine) },
      { key: "Ctrl-t", run: insertOnly(transposeChars) },
    ]),
  );
}

export interface VimExtensionOptions {
  yankHighlightMs: number;
  onModeChange: (mode: VimModeLabel) => void;
  onSave: () => void;
  onQuit?: () => void;
}

export function createVimExtension(options: VimExtensionOptions): Extension {
  registerGlobalVimEnhancements();

  const bridgePlugin = ViewPlugin.fromClass(
    class {
      private view: EditorView;
      private modeHandler: (ev: { mode?: string; subMode?: string }) => void;

      constructor(view: EditorView) {
        this.view = view;
        viewConfigs.set(view, {
          durationMs: options.yankHighlightMs,
          onSave: options.onSave,
          onQuit: options.onQuit,
        });

        this.modeHandler = (ev) => {
          const mode = ev?.mode ?? "normal";
          const sub = ev?.subMode ?? "";
          if (mode === "insert") options.onModeChange("INSERT");
          else if (mode === "replace") options.onModeChange("REPLACE");
          else if (mode === "visual") {
            if (sub === "linewise") options.onModeChange("V-LINE");
            else if (sub === "blockwise") options.onModeChange("V-BLOCK");
            else options.onModeChange("VISUAL");
          } else {
            options.onModeChange("NORMAL");
          }
        };

        queueMicrotask(() => {
          const cm = getCM(this.view);
          cm?.on("vim-mode-change", this.modeHandler);
          options.onModeChange("NORMAL");
        });
      }

      update(_update: ViewUpdate) {
        const cfg = viewConfigs.get(this.view);
        if (cfg) {
          cfg.durationMs = options.yankHighlightMs;
          cfg.onSave = options.onSave;
          cfg.onQuit = options.onQuit;
        }
      }

      destroy() {
        const cm = getCM(this.view);
        cm?.off("vim-mode-change", this.modeHandler);
        const cfg = viewConfigs.get(this.view);
        if (cfg?.timer !== undefined) {
          window.clearTimeout(cfg.timer);
        }
        viewConfigs.delete(this.view);
      }
    },
  );

  return [vim({ status: false }), yankFlashField, bridgePlugin];
}
