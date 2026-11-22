import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, StateField, type EditorState, type Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { readImageDataUrl, resolveImageSrc } from "../state/ipc";

function getActiveLines(state: EditorState): Set<number> {
  const active = new Set<number>();
  for (const range of state.selection.ranges) {
    const startLine = state.doc.lineAt(range.from).number;
    const endLine = state.doc.lineAt(range.to).number;
    for (let l = startLine; l <= endLine; l++) {
      active.add(l);
    }
  }
  return active;
}

class BulletWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-rm-bullet";
    span.textContent = "•";
    return span;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly pos: number,
  ) {
    super();
  }

  eq(other: CheckboxWidget): boolean {
    return this.checked === other.checked && this.pos === other.pos;
  }

  toDOM(view: EditorView): HTMLElement {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "cm-rm-checkbox";
    input.checked = this.checked;
    input.setAttribute("aria-label", "Toggle task");
    input.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const next = this.checked ? "[ ]" : "[x]";
      view.dispatch({
        changes: { from: this.pos, to: this.pos + 3, insert: next },
      });
    });
    return input;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class CodeLangWidget extends WidgetType {
  constructor(readonly lang: string) {
    super();
  }

  eq(other: CodeLangWidget): boolean {
    return this.lang === other.lang;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-rm-code-lang";
    span.textContent = this.lang || "code";
    return span;
  }
}

class HrWidget extends WidgetType {
  toDOM(): HTMLElement {
    const hr = document.createElement("span");
    hr.className = "cm-rm-hr";
    return hr;
  }
}

class ImagePreviewWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly rawSrc: string,
    readonly alt: string,
    readonly activeFilePath: string | null,
    readonly rootDir: string | null,
  ) {
    super();
  }

  eq(other: ImagePreviewWidget): boolean {
    return this.src === other.src && this.alt === other.alt;
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-rm-image-widget";

    const img = document.createElement("img");
    img.src = this.src;
    img.alt = this.alt;
    img.loading = "lazy";

    let triedFallback = false;
    img.onerror = () => {
      if (!triedFallback && !/^(https?:|data:|blob:)/i.test(this.rawSrc)) {
        triedFallback = true;
        let localPath = this.rawSrc.trim().replace(/^\.\//, "");
        if (!localPath.startsWith("/") && !localPath.startsWith("file://")) {
          const baseDir = this.activeFilePath
            ? this.activeFilePath.slice(0, this.activeFilePath.lastIndexOf("/"))
            : this.rootDir;
          if (baseDir) {
            localPath = `${baseDir}/${localPath}`;
          }
        }
        readImageDataUrl(localPath)
          .then((dataUrl) => {
            img.src = dataUrl;
          })
          .catch(() => {
            img.remove();
            const err = document.createElement("div");
            err.className = "cm-rm-image-error";
            err.textContent = `Image unavailable: ${this.rawSrc}`;
            wrapper.prepend(err);
          });
        return;
      }
      img.remove();
      const err = document.createElement("div");
      err.className = "cm-rm-image-error";
      err.textContent = `Image unavailable: ${this.rawSrc}`;
      wrapper.prepend(err);
    };
    wrapper.appendChild(img);

    if (this.alt) {
      const caption = document.createElement("div");
      caption.className = "cm-rm-image-caption";
      caption.textContent = this.alt;
      wrapper.appendChild(caption);
    }

    return wrapper;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

// Matches ![alt](path or url) including paths with spaces or optional "title"
const IMAGE_REGEX = /!\[([^\]]*)\]\(([^)"\n]+?)(?:\s+"[^"]*")?\)/g;
const INLINE_TAG_REGEX = /(^|\s)(#[A-Za-z0-9_\-/]+)/g;

/**
 * Block-level inline image previews live in a StateField (required by CM6 for block widgets).
 * Images always render directly below their Markdown line (even while editing that line)
 * so pasted images appear immediately without having to move the cursor away.
 */
function createImagePreviewField(
  getActiveFilePath: () => string | null,
  getRootDir: () => string | null,
): StateField<DecorationSet> {
  const build = (state: EditorState): DecorationSet => {
    const builder = new RangeSetBuilder<Decoration>();
    const activeFile = getActiveFilePath();
    const rootDir = getRootDir();

    for (let lineNo = 1; lineNo <= state.doc.lines; lineNo++) {
      const line = state.doc.line(lineNo);
      IMAGE_REGEX.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = IMAGE_REGEX.exec(line.text)) !== null) {
        const alt = match[1] ?? "";
        const rawSrc = (match[2] ?? "").trim();
        if (!rawSrc) continue;
        const resolved = resolveImageSrc(rawSrc, activeFile, rootDir);
        builder.add(
          line.to,
          line.to,
          Decoration.widget({
            widget: new ImagePreviewWidget(resolved, rawSrc, alt, activeFile, rootDir),
            block: true,
            side: 1,
          }),
        );
      }
    }

    return builder.finish();
  };

  return StateField.define<DecorationSet>({
    create(state) {
      return build(state);
    },
    update(decos, tr) {
      if (tr.docChanged) {
        return build(tr.state);
      }
      return decos;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}

function getFrontmatterEndLine(state: EditorState): number {
  if (state.doc.lines < 3) return 0;
  if (state.doc.line(1).text.trim() !== "---") return 0;
  for (let ln = 2; ln <= Math.min(state.doc.lines, 80); ln++) {
    if (state.doc.line(ln).text.trim() === "---") return ln;
  }
  return 0;
}

function createHideFrontmatterField(): StateField<DecorationSet> {
  const build = (state: EditorState): DecorationSet => {
    const fmEndLine = getFrontmatterEndLine(state);
    if (fmEndLine <= 0) return Decoration.none;
    const endLine = state.doc.line(fmEndLine);
    const hideTo = Math.min(state.doc.length, endLine.to + (fmEndLine < state.doc.lines ? 1 : 0));
    const builder = new RangeSetBuilder<Decoration>();
    builder.add(0, hideTo, Decoration.replace({ block: true }));
    return builder.finish();
  };
  return StateField.define<DecorationSet>({
    create(state) {
      return build(state);
    },
    update(decos, tr) {
      return tr.docChanged ? build(tr.state) : decos;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}

function buildInlineDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const activeLines = getActiveLines(state);
  const fmEndLine = getFrontmatterEndLine(state);
  const items: Array<{ from: number; to: number; deco: Decoration }> = [];
  const styledLines = new Set<string>();
  const codeBlockLines = new Set<number>();

  const addLineClass = (lineFrom: number, cls: string) => {
    const key = `${lineFrom}:${cls}`;
    if (styledLines.has(key)) return;
    styledLines.add(key);
    items.push({ from: lineFrom, to: lineFrom, deco: Decoration.line({ class: cls }) });
  };

  // Style YAML frontmatter cleanly and prevent Markdown from misparsing `---` as Setext/HR/Link
  if (fmEndLine > 0) {
    for (let ln = 1; ln <= fmEndLine; ln++) {
      codeBlockLines.add(ln);
      const line = state.doc.line(ln);
      const cls = ["cm-rm-fm-line"];
      if (ln === 1) cls.push("cm-rm-fm-start");
      if (ln === fmEndLine) cls.push("cm-rm-fm-end");
      addLineClass(line.from, cls.join(" "));
      if (!activeLines.has(ln) && (ln === 1 || ln === fmEndLine)) {
        items.push({
          from: line.from,
          to: line.to,
          deco: Decoration.mark({ class: "cm-rm-fm-fence" }),
        });
      }
    }
  }

  const tree = syntaxTree(state);

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        const startLine = state.doc.lineAt(node.from);
        const endLine = state.doc.lineAt(node.to);

        // Never apply Markdown decorations inside YAML frontmatter
        if (fmEndLine > 0 && startLine.number <= fmEndLine) {
          return false;
        }

        // Multi-line FencedCode block background & fence badges
        if (node.name === "FencedCode") {
          for (let ln = startLine.number; ln <= endLine.number; ln++) {
            codeBlockLines.add(ln);
            if (activeLines.has(ln)) continue;
            const line = state.doc.line(ln);
            const classes = ["cm-rm-codeblock-line"];
            if (ln === startLine.number) classes.push("cm-rm-codeblock-start");
            if (ln === endLine.number) classes.push("cm-rm-codeblock-end");
            addLineClass(line.from, classes.join(" "));

            if (ln === startLine.number) {
              const lang = line.text.trim().replace(/^`{3,}|^~{3,}/, "").trim();
              items.push({
                from: line.from,
                to: line.to,
                deco: Decoration.replace({ widget: new CodeLangWidget(lang) }),
              });
            } else if (ln === endLine.number && /^(`{3,}|~{3,})\s*$/.test(line.text.trim())) {
              items.push({
                from: line.from,
                to: line.to,
                deco: Decoration.replace({}),
              });
            }
          }
          return false;
        }

        // Blockquotes
        if (node.name === "Blockquote") {
          for (let ln = startLine.number; ln <= endLine.number; ln++) {
            if (activeLines.has(ln)) continue;
            const line = state.doc.line(ln);
            addLineClass(line.from, "cm-rm-quote-line");
          }
          return;
        }

        // Tables
        if (node.name === "Table") {
          for (let ln = startLine.number; ln <= endLine.number; ln++) {
            if (activeLines.has(ln)) continue;
            const line = state.doc.line(ln);
            addLineClass(line.from, "cm-rm-table-line");
          }
          return;
        }

        // Skip single-line decorations when cursor is on that line (render-markdown.nvim style)
        if (activeLines.has(startLine.number)) return;

        // Hide raw ![alt](url) markdown syntax on inactive lines since the image widget renders below
        if (node.name === "Image") {
          items.push({ from: node.from, to: node.to, deco: Decoration.replace({}) });
          return false;
        }

        // ATX Headings
        if (node.name.startsWith("ATXHeading")) {
          const level = node.name.slice("ATXHeading".length);
          addLineClass(startLine.from, `cm-rm-h${level}`);
          const text = state.doc.sliceString(node.from, node.to);
          const match = text.match(/^(#{1,6}\s+)/);
          if (match) {
            items.push({
              from: node.from,
              to: node.from + match[1].length,
              deco: Decoration.replace({}),
            });
          }
          return;
        }

        // Quote marker `> `
        if (node.name === "QuoteMark") {
          const after = state.doc.sliceString(node.to, node.to + 1);
          const end = after === " " ? node.to + 1 : node.to;
          items.push({ from: node.from, to: end, deco: Decoration.replace({}) });
          return;
        }

        // Task list checkbox `[ ]` / `[x]`
        if (node.name === "TaskMarker") {
          const raw = state.doc.sliceString(node.from, node.to);
          const checked = /\[[xX]\]/.test(raw);
          items.push({
            from: node.from,
            to: node.to,
            deco: Decoration.replace({ widget: new CheckboxWidget(checked, node.from) }),
          });
          if (checked && node.to < startLine.to) {
            items.push({
              from: node.to,
              to: startLine.to,
              deco: Decoration.mark({ class: "cm-rm-task-done" }),
            });
          }
          return;
        }

        // Bullet list marker `-`, `*`, `+` (skip if followed by TaskMarker)
        if (node.name === "ListMark") {
          const marker = state.doc.sliceString(node.from, node.to);
          if (marker === "-" || marker === "*" || marker === "+") {
            const rest = state.doc.sliceString(node.to, Math.min(startLine.to, node.to + 5));
            if (/^\s+\[[ xX]\]/.test(rest)) {
              items.push({
                from: node.from,
                to: Math.min(startLine.to, node.to + 1),
                deco: Decoration.replace({}),
              });
            } else {
              items.push({
                from: node.from,
                to: node.to,
                deco: Decoration.replace({ widget: new BulletWidget() }),
              });
            }
          }
          return;
        }

        // Horizontal rule
        if (node.name === "HorizontalRule") {
          items.push({
            from: node.from,
            to: node.to,
            deco: Decoration.replace({ widget: new HrWidget() }),
          });
          return;
        }

        // Inline code `code`
        if (node.name === "InlineCode") {
          const raw = state.doc.sliceString(node.from, node.to);
          const ticks = raw.match(/^`+/)?.[0].length ?? 1;
          if (node.to - node.from > ticks * 2) {
            items.push({ from: node.from, to: node.from + ticks, deco: Decoration.replace({}) });
            items.push({
              from: node.from + ticks,
              to: node.to - ticks,
              deco: Decoration.mark({ class: "cm-rm-inline-code" }),
            });
            items.push({ from: node.to - ticks, to: node.to, deco: Decoration.replace({}) });
          }
          return false;
        }

        // Strong **bold**
        if (node.name === "StrongEmphasis") {
          if (node.to - node.from > 4) {
            items.push({ from: node.from, to: node.from + 2, deco: Decoration.replace({}) });
            items.push({
              from: node.from + 2,
              to: node.to - 2,
              deco: Decoration.mark({ class: "cm-rm-strong" }),
            });
            items.push({ from: node.to - 2, to: node.to, deco: Decoration.replace({}) });
          }
          return;
        }

        // Emphasis *italic*
        if (node.name === "Emphasis") {
          if (node.to - node.from > 2) {
            items.push({ from: node.from, to: node.from + 1, deco: Decoration.replace({}) });
            items.push({
              from: node.from + 1,
              to: node.to - 1,
              deco: Decoration.mark({ class: "cm-rm-emphasis" }),
            });
            items.push({ from: node.to - 1, to: node.to, deco: Decoration.replace({}) });
          }
          return;
        }

        // Strikethrough ~~text~~
        if (node.name === "Strikethrough") {
          if (node.to - node.from > 4) {
            items.push({ from: node.from, to: node.from + 2, deco: Decoration.replace({}) });
            items.push({
              from: node.from + 2,
              to: node.to - 2,
              deco: Decoration.mark({ class: "cm-rm-strike" }),
            });
            items.push({ from: node.to - 2, to: node.to, deco: Decoration.replace({}) });
          }
        }
      },
    });

    // Subtle inline #tag pills on visible non-code, non-active lines
    const firstLine = state.doc.lineAt(from).number;
    const lastLine = state.doc.lineAt(to).number;
    for (let ln = firstLine; ln <= lastLine; ln++) {
      if (activeLines.has(ln) || codeBlockLines.has(ln)) continue;
      const line = state.doc.line(ln);
      if (line.text.startsWith("#")) continue; // Skip ATX headings
      INLINE_TAG_REGEX.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = INLINE_TAG_REGEX.exec(line.text)) !== null) {
        const prefixLen = m[1]?.length ?? 0;
        const tagText = m[2] ?? "";
        const raw = tagText.slice(1);
        if ((raw.length === 3 || raw.length === 6) && /^[0-9a-fA-F]+$/.test(raw)) continue;
        const tagFrom = line.from + m.index + prefixLen;
        const tagTo = tagFrom + tagText.length;
        items.push({
          from: tagFrom,
          to: tagTo,
          deco: Decoration.mark({ class: "cm-rm-tag" }),
        });
      }
    }
  }

  items.sort((a, b) => a.from - b.from || a.to - b.to);
  const builder = new RangeSetBuilder<Decoration>();
  for (const item of items) {
    builder.add(item.from, item.to, item.deco);
  }
  return builder.finish();
}

/**
 * Lightweight `render-markdown.nvim`-inspired CodeMirror 6 extension.
 * Keeps the active cursor line in raw Markdown while cleanly rendering all other lines,
 * and displays inline image previews immediately.
 */
export function createRenderMarkdownExtension(
  getActiveFilePath: () => string | null,
  getRootDir: () => string | null = () => null,
  showFrontmatterInEditor = true,
): Extension {
  const inlinePlugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildInlineDecorations(view);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = buildInlineDecorations(update.view);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );

  const exts: Extension[] = [inlinePlugin, createImagePreviewField(getActiveFilePath, getRootDir)];
  if (!showFrontmatterInEditor) {
    exts.push(createHideFrontmatterField());
  }
  return exts;
}
