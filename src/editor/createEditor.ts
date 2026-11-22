import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension, type StateEffect } from "@codemirror/state";
import {
  EditorView,
  GutterMarker,
  drawSelection,
  gutter,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { GFM } from "@lezer/markdown";
import type { AppConfig, LineNumberMode, StorageConfig } from "../state/ipc";
import { pluginRegistry } from "../plugins/registry";
import { createImagePasteExtension } from "./imagePaste";
import { createRenderMarkdownExtension } from "./renderMarkdown";
import { createMacEmacsInsertKeymap, createVimExtension, type VimModeLabel } from "./vimExtension";

export interface CursorMetrics {
  line: number;
  col: number;
  words: number;
  chars: number;
}

export interface NibEditorController {
  view: EditorView;
  setContent: (content: string, resetCursor?: boolean) => void;
  scrollToLine: (lineNumber: number) => void;
  applyConfig: (config: AppConfig) => void;
  syncPlugins: () => void;
  destroy: () => void;
}

export interface CreateEditorParams {
  parent: HTMLElement;
  initialContent: string;
  config: AppConfig;
  getStorageConfig: () => StorageConfig;
  getActiveFilePath: () => string | null;
  getRootDir: () => string | null;
  onSave: () => void;
  onQuit?: () => void;
  onStatus?: (message: string) => void;
  onChange: (content: string) => void;
  onCursorChange: (metrics: CursorMetrics) => void;
  onVimModeChange: (mode: VimModeLabel) => void;
}

const nibHighlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.operatorKeyword], color: "var(--nib-syn-keyword)" },
  { tag: [t.string, t.special(t.string)], color: "var(--nib-syn-string)" },
  {
    tag: [t.comment, t.lineComment, t.blockComment],
    color: "var(--nib-syn-comment)",
    fontStyle: "italic",
  },
  { tag: [t.number, t.bool, t.null], color: "var(--nib-syn-number)" },
  { tag: [t.typeName, t.className, t.namespace], color: "var(--nib-syn-type)" },
  { tag: [t.function(t.variableName), t.propertyName], color: "var(--nib-syn-fn)" },
  { tag: [t.meta, t.processingInstruction], color: "var(--nib-syn-meta)" },
  { tag: t.heading, fontWeight: "700", color: "var(--nib-text)" },
  { tag: t.link, color: "var(--nib-accent)", textDecoration: "underline" },
  { tag: t.url, color: "var(--nib-text-secondary)" },
  { tag: t.monospace, fontFamily: "var(--nib-font-mono)" },
]);

class RelativeLineMarker extends GutterMarker {
  constructor(
    readonly label: string,
    readonly isActive: boolean,
  ) {
    super();
  }

  eq(other: RelativeLineMarker): boolean {
    return this.label === other.label && this.isActive === other.isActive;
  }

  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = this.isActive ? "cm-relnum-active" : "cm-relnum-rel";
    el.textContent = this.label;
    return el;
  }
}

function createHybridRelativeLineNumbers(): Extension {
  const makeSpacer = (lines: number) =>
    new RelativeLineMarker("9".repeat(Math.max(2, String(lines).length)), false);

  return [
    gutter({
      class: "cm-lineNumbers cm-relativeLineNumbers",
      lineMarker(view, line) {
        const lineNo = view.state.doc.lineAt(line.from).number;
        const activeNo = view.state.doc.lineAt(view.state.selection.main.head).number;
        if (lineNo === activeNo) {
          return new RelativeLineMarker(String(lineNo), true);
        }
        return new RelativeLineMarker(String(Math.abs(lineNo - activeNo)), false);
      },
      lineMarkerChange(update) {
        return update.selectionSet || update.docChanged;
      },
      initialSpacer(view) {
        return makeSpacer(view.state.doc.lines);
      },
      updateSpacer(spacer, update) {
        const digits = Math.max(2, String(update.state.doc.lines).length);
        const curDigits = (spacer as RelativeLineMarker).label.length;
        return digits !== curDigits ? makeSpacer(update.state.doc.lines) : spacer;
      },
    }),
    highlightActiveLineGutter(),
  ];
}

function makeLineNumbersExt(mode: LineNumberMode | string): Extension {
  if (mode === "off") return [];
  if (mode === "absolute") return [lineNumbers(), highlightActiveLineGutter()];
  return createHybridRelativeLineNumbers();
}

function makeEditorWidthExt(width: string): Extension {
  const cls = width === "full" ? "nib-width-full" : "nib-width-centered";
  return EditorView.editorAttributes.of({ class: cls });
}

function computeMetrics(state: EditorState): CursorMetrics {
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  const text = state.doc.toString();
  const trimmed = text.trim();
  const words = trimmed ? trimmed.split(/\s+/).length : 0;
  return {
    line: line.number,
    col: pos - line.from + 1,
    words,
    chars: text.length,
  };
}

export function createNibEditor(params: CreateEditorParams): NibEditorController {
  const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;
  const vimCompartment = new Compartment();
  const renderMdCompartment = new Compartment();
  const lineNumbersCompartment = new Compartment();
  const editorWidthCompartment = new Compartment();
  const indentCompartment = new Compartment();
  const pluginsCompartment = new Compartment();

  let suppressChange = false;

  // Track previous editor settings so unrelated config changes never wipe Vim state or image widgets
  let prevVimMode = params.config.editor.vim_mode;
  let prevRenderMode = params.config.editor.render_mode;
  let prevShowFm = params.config.editor.show_frontmatter_in_editor;
  let prevLineNumberMode = params.config.editor.line_number_mode;
  let prevEditorWidth = params.config.editor.editor_width;
  let prevTabSize = params.config.editor.tab_size;

  const makeVimExt = (cfg: AppConfig): Extension =>
    !isMobile && cfg.editor.vim_mode
      ? createVimExtension({
          yankHighlightMs: cfg.editor.yank_highlight_ms,
          onModeChange: params.onVimModeChange,
          onSave: params.onSave,
          onQuit: params.onQuit,
        })
      : [];

  const makeRenderMdExt = (cfg: AppConfig): Extension =>
    createRenderMarkdownExtension(
      params.getActiveFilePath,
      params.getRootDir,
      cfg.editor.render_mode,
      cfg.editor.show_frontmatter_in_editor,
    );

  const state = EditorState.create({
    doc: params.initialContent,
    extensions: [
      createMacEmacsInsertKeymap(),
      vimCompartment.of(makeVimExt(params.config)),
      history(),
      // Use native iOS caret & selection handles on mobile (avoids WKWebView drawSelection vertical offset)
      ...(isMobile ? [] : [drawSelection(), highlightActiveLine()]),
      highlightSelectionMatches(),
      EditorView.lineWrapping,
      editorWidthCompartment.of(makeEditorWidthExt(params.config.editor.editor_width)),
      syntaxHighlighting(nibHighlightStyle),
      markdown({
        base: markdownLanguage,
        codeLanguages: languages,
        extensions: [GFM],
      }),
      renderMdCompartment.of(makeRenderMdExt(params.config)),
      createImagePasteExtension({
        getStorageConfig: params.getStorageConfig,
        getActiveFilePath: params.getActiveFilePath,
        getRootDir: params.getRootDir,
        onStatus: params.onStatus,
      }),
      lineNumbersCompartment.of(
        isMobile ? [] : makeLineNumbersExt(params.config.editor.line_number_mode),
      ),
      indentCompartment.of(indentUnit.of(" ".repeat(Math.max(1, params.config.editor.tab_size)))),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      pluginsCompartment.of(pluginRegistry.getEditorExtensions()),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !suppressChange) {
          params.onChange(update.state.doc.toString());
        }
        if (update.docChanged || update.selectionSet) {
          params.onCursorChange(computeMetrics(update.state));
        }
      }),
    ],
  });

  const view = new EditorView({ state, parent: params.parent });
  params.onCursorChange(computeMetrics(view.state));

  return {
    view,
    setContent(content: string, resetCursor = false) {
      const current = view.state.doc.toString();
      if (current === content) return;
      const prevHead = view.state.selection.main.head;
      const nextAnchor = resetCursor ? 0 : Math.min(prevHead, content.length);
      suppressChange = true;
      view.dispatch({
        changes: { from: 0, to: current.length, insert: content },
        selection: { anchor: nextAnchor },
      });
      suppressChange = false;
      params.onCursorChange(computeMetrics(view.state));
    },
    scrollToLine(lineNumber: number) {
      const clamped = Math.min(Math.max(1, lineNumber), view.state.doc.lines);
      const line = view.state.doc.line(clamped);
      view.dispatch({
        selection: { anchor: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: "center" }),
      });
      view.focus();
    },
    applyConfig(config: AppConfig) {
      const effects: StateEffect<unknown>[] = [];
      if (config.editor.vim_mode !== prevVimMode) {
        prevVimMode = config.editor.vim_mode;
        effects.push(vimCompartment.reconfigure(makeVimExt(config)));
      }
      if (
        config.editor.render_mode !== prevRenderMode ||
        config.editor.show_frontmatter_in_editor !== prevShowFm
      ) {
        prevRenderMode = config.editor.render_mode;
        prevShowFm = config.editor.show_frontmatter_in_editor;
        effects.push(renderMdCompartment.reconfigure(makeRenderMdExt(config)));
      }
      if (config.editor.line_number_mode !== prevLineNumberMode) {
        prevLineNumberMode = config.editor.line_number_mode;
        effects.push(
          lineNumbersCompartment.reconfigure(
            isMobile ? [] : makeLineNumbersExt(config.editor.line_number_mode),
          ),
        );
      }
      if (config.editor.editor_width !== prevEditorWidth) {
        prevEditorWidth = config.editor.editor_width;
        effects.push(
          editorWidthCompartment.reconfigure(makeEditorWidthExt(config.editor.editor_width)),
        );
      }
      if (config.editor.tab_size !== prevTabSize) {
        prevTabSize = config.editor.tab_size;
        effects.push(
          indentCompartment.reconfigure(
            indentUnit.of(" ".repeat(Math.max(1, config.editor.tab_size))),
          ),
        );
      }
      if (effects.length > 0) {
        view.dispatch({ effects });
      }
    },
    syncPlugins() {
      view.dispatch({
        effects: pluginsCompartment.reconfigure(pluginRegistry.getEditorExtensions()),
      });
    },
    destroy() {
      view.destroy();
    },
  };
}
