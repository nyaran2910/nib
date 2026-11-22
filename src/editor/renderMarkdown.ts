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
import { readImageDataUrl, resolveImageSrc, type RenderMode } from "../state/ipc";

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

const LATEX_SYMBOLS: Record<string, string> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  varepsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  vartheta: "ϑ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  tau: "τ",
  upsilon: "υ",
  phi: "φ",
  varphi: "φ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Xi: "Ξ",
  Pi: "Π",
  Sigma: "Σ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",
  pm: "±",
  mp: "∓",
  times: "×",
  div: "÷",
  cdot: "·",
  ast: "∗",
  star: "⋆",
  le: "≤",
  leq: "≤",
  ge: "≥",
  geq: "≥",
  ne: "≠",
  neq: "≠",
  approx: "≈",
  equiv: "≡",
  sim: "∼",
  propto: "∝",
  to: "→",
  rightarrow: "→",
  leftarrow: "←",
  leftrightarrow: "↔",
  Rightarrow: "⇒",
  Leftarrow: "⇐",
  Leftrightarrow: "⇔",
  iff: "⇔",
  mapsto: "↦",
  in: "∈",
  notin: "∉",
  ni: "∋",
  subset: "⊂",
  subseteq: "⊆",
  supset: "⊃",
  supseteq: "⊇",
  cup: "∪",
  cap: "∩",
  emptyset: "∅",
  varnothing: "∅",
  forall: "∀",
  exists: "∃",
  neg: "¬",
  land: "∧",
  lor: "∨",
  nabla: "∇",
  partial: "∂",
  infty: "∞",
  sum: "∑",
  prod: "∏",
  int: "∫",
  iint: "∬",
  oint: "∮",
  ldots: "…",
  cdots: "⋯",
  dots: "…",
  degree: "°",
  circ: "∘",
  angle: "∠",
  perp: "⊥",
  parallel: "∥",
  prime: "′",
};

function readBracedGroup(src: string, start: number): { content: string; next: number } {
  let i = start;
  while (i < src.length && src[i] === " ") i++;
  if (i >= src.length) return { content: "", next: i };
  if (src[i] !== "{") {
    if (src[i] === "\\") {
      const m = src.slice(i).match(/^\\[A-Za-z]+/);
      if (m) return { content: m[0], next: i + m[0].length };
    }
    return { content: src[i], next: i + 1 };
  }
  let depth = 0;
  let j = i;
  while (j < src.length) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") {
      depth--;
      if (depth === 0) {
        return { content: src.slice(i + 1, j), next: j + 1 };
      }
    }
    j++;
  }
  return { content: src.slice(i + 1), next: src.length };
}

function appendLatexNodes(parent: HTMLElement, tex: string): void {
  let i = 0;
  let textBuf = "";
  const flush = () => {
    if (textBuf) {
      parent.appendChild(document.createTextNode(textBuf));
      textBuf = "";
    }
  };

  while (i < tex.length) {
    const ch = tex[i];
    if (ch === "\\") {
      const cmdMatch = tex.slice(i + 1).match(/^([A-Za-z]+|[^A-Za-z\s])/);
      if (!cmdMatch) {
        textBuf += ch;
        i++;
        continue;
      }
      const cmd = cmdMatch[1];
      i += 1 + cmd.length;

      if (cmd === "frac" || cmd === "dfrac" || cmd === "tfrac") {
        flush();
        const num = readBracedGroup(tex, i);
        const den = readBracedGroup(tex, num.next);
        i = den.next;
        const frac = document.createElement("span");
        frac.className = "cm-rm-math-frac";
        const numEl = document.createElement("span");
        numEl.className = "cm-rm-math-num";
        appendLatexNodes(numEl, num.content);
        const denEl = document.createElement("span");
        denEl.className = "cm-rm-math-den";
        appendLatexNodes(denEl, den.content);
        frac.append(numEl, denEl);
        parent.appendChild(frac);
        continue;
      }

      if (cmd === "sqrt") {
        flush();
        const arg = readBracedGroup(tex, i);
        i = arg.next;
        const wrap = document.createElement("span");
        wrap.className = "cm-rm-math-sqrt";
        const rad = document.createElement("span");
        rad.textContent = "√";
        const body = document.createElement("span");
        body.className = "cm-rm-math-sqrt-body";
        appendLatexNodes(body, arg.content);
        wrap.append(rad, body);
        parent.appendChild(wrap);
        continue;
      }

      if (cmd === "text" || cmd === "mathrm" || cmd === "operatorname") {
        flush();
        const arg = readBracedGroup(tex, i);
        i = arg.next;
        const span = document.createElement("span");
        span.className = "cm-rm-math-rm";
        span.textContent = arg.content;
        parent.appendChild(span);
        continue;
      }

      if (cmd === "mathbf" || cmd === "boldsymbol" || cmd === "mathbb") {
        flush();
        const arg = readBracedGroup(tex, i);
        i = arg.next;
        const span = document.createElement("span");
        span.className = "cm-rm-math-bf";
        appendLatexNodes(span, arg.content);
        parent.appendChild(span);
        continue;
      }

      if (cmd === "left" || cmd === "right") {
        continue;
      }
      if (cmd === "," || cmd === ";" || cmd === ":" || cmd === "quad" || cmd === "qquad") {
        textBuf += " ";
        continue;
      }
      if (cmd === "{" || cmd === "}" || cmd === "%" || cmd === "_") {
        textBuf += cmd;
        continue;
      }
      if (cmd in LATEX_SYMBOLS) {
        textBuf += LATEX_SYMBOLS[cmd];
        continue;
      }
      textBuf += cmd;
      continue;
    }

    if (ch === "^" || ch === "_") {
      flush();
      const grp = readBracedGroup(tex, i + 1);
      i = grp.next;
      const el = document.createElement(ch === "^" ? "sup" : "sub");
      el.className = ch === "^" ? "cm-rm-math-sup" : "cm-rm-math-sub";
      appendLatexNodes(el, grp.content);
      parent.appendChild(el);
      continue;
    }

    if (ch === "{" || ch === "}") {
      i++;
      continue;
    }

    textBuf += ch;
    i++;
  }
  flush();
}

const CIRCLED_LEVELS = ["", "①", "②", "③", "④", "⑤", "⑥"];

class HeadingBadgeWidget extends WidgetType {
  constructor(readonly level: number) {
    super();
  }
  eq(other: HeadingBadgeWidget): boolean {
    return this.level === other.level;
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = `cm-rm-h-badge cm-rm-h-badge-${this.level}`;
    span.textContent = CIRCLED_LEVELS[this.level] ?? `H${this.level}`;
    return span;
  }
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

class InlineMathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly displayMode = false,
  ) {
    super();
  }
  eq(other: InlineMathWidget): boolean {
    return this.tex === other.tex && this.displayMode === other.displayMode;
  }
  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = this.displayMode ? "cm-rm-math-inline is-display" : "cm-rm-math-inline";
    appendLatexNodes(el, this.tex.trim());
    return el;
  }
}

class BlockMathWidget extends WidgetType {
  constructor(readonly tex: string) {
    super();
  }
  eq(other: BlockMathWidget): boolean {
    return this.tex === other.tex;
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-rm-math-block";
    const lines = this.tex.trim().split(/\r?\n/);
    for (const line of lines) {
      const row = document.createElement("div");
      row.className = "cm-rm-math-block-row";
      appendLatexNodes(row, line.trim());
      wrap.appendChild(row);
    }
    return wrap;
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

const IMAGE_REGEX = /!\[([^\]]*)\]\(([^)"\n]+?)(?:\s+"[^"]*")?\)/g;
const INLINE_TAG_REGEX = /(^|\s)(#[A-Za-z0-9_\-/]+)/g;
const DISPLAY_INLINE_MATH_REGEX = /\$\$([^$\n]+?)\$\$/g;
const INLINE_MATH_REGEX = /(?<!\$)\$(?!\$|\s)([^$\n]+?)(?<!\s)\$(?!\$)/g;
const HR_LINE_REGEX = /^\s*([-*_])(?:\s*\1){2,}\s*$/;

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
      return tr.docChanged ? build(tr.state) : decos;
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

/**
 * Multi-line block math `$$\n...\n$$` rendered via a StateField (required for multi-line block replacements).
 * Reveals raw LaTeX immediately when cursor enters any line inside the block.
 */
function createBlockMathField(): StateField<DecorationSet> {
  const build = (state: EditorState): DecorationSet => {
    const activeLines = getActiveLines(state);
    const fmEnd = getFrontmatterEndLine(state);
    const builder = new RangeSetBuilder<Decoration>();

    let inCode = false;
    let mathStartLine = -1;
    let mathLines: string[] = [];

    for (let ln = Math.max(1, fmEnd + 1); ln <= state.doc.lines; ln++) {
      const line = state.doc.line(ln);
      const trimmed = line.text.trim();

      if (/^(`{3,}|~{3,})/.test(trimmed)) {
        if (mathStartLine === -1) inCode = !inCode;
        continue;
      }
      if (inCode) continue;

      if (trimmed === "$$") {
        if (mathStartLine === -1) {
          mathStartLine = ln;
          mathLines = [];
        } else {
          let isActive = false;
          for (let k = mathStartLine; k <= ln; k++) {
            if (activeLines.has(k)) {
              isActive = true;
              break;
            }
          }
          if (!isActive && mathLines.length > 0) {
            const from = state.doc.line(mathStartLine).from;
            const to = line.to;
            builder.add(
              from,
              to,
              Decoration.replace({
                widget: new BlockMathWidget(mathLines.join("\n")),
                block: true,
              }),
            );
          }
          mathStartLine = -1;
          mathLines = [];
        }
      } else if (mathStartLine !== -1) {
        mathLines.push(line.text);
      }
    }

    return builder.finish();
  };

  return StateField.define<DecorationSet>({
    create(state) {
      return build(state);
    },
    update(decos, tr) {
      return tr.docChanged || tr.selection ? build(tr.state) : decos;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}

function buildInlineDecorations(view: EditorView, mode: "rich" | "minimal"): DecorationSet {
  const { state } = view;
  const activeLines = getActiveLines(state);
  const fmEndLine = getFrontmatterEndLine(state);
  const items: Array<{ from: number; to: number; deco: Decoration }> = [];
  const styledLines = new Set<string>();
  const codeBlockLines = new Set<number>();
  const minimal = mode === "minimal";

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

        // Multi-line FencedCode block: track code lines in both modes; style card in rich mode.
        // Keep background on active lines too so visual selection never shifts or leaves holes.
        if (node.name === "FencedCode") {
          for (let ln = startLine.number; ln <= endLine.number; ln++) {
            codeBlockLines.add(ln);
            if (minimal) continue;
            const line = state.doc.line(ln);
            const classes = ["cm-rm-codeblock-line"];
            if (ln === startLine.number) classes.push("cm-rm-codeblock-start");
            if (ln === endLine.number) classes.push("cm-rm-codeblock-end");
            addLineClass(line.from, classes.join(" "));

            if (activeLines.has(ln)) continue;

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

        // Tables (rendered in both rich & minimal)
        if (node.name === "Table") {
          for (let ln = startLine.number; ln <= endLine.number; ln++) {
            const line = state.doc.line(ln);
            addLineClass(line.from, "cm-rm-table-line");
          }
          return;
        }

        // Blockquotes (rich mode only)
        if (!minimal && node.name === "Blockquote") {
          for (let ln = startLine.number; ln <= endLine.number; ln++) {
            if (activeLines.has(ln)) continue;
            const line = state.doc.line(ln);
            addLineClass(line.from, "cm-rm-quote-line");
          }
          return;
        }

        // Active cursor line stays raw Markdown
        if (activeLines.has(startLine.number)) return;

        // Hide raw ![alt](url) markdown syntax on inactive lines (both rich & minimal)
        if (node.name === "Image") {
          items.push({ from: node.from, to: node.to, deco: Decoration.replace({}) });
          return false;
        }

        // ATX Headings
        if (node.name.startsWith("ATXHeading")) {
          const levelNum = Number(node.name.slice("ATXHeading".length)) || 1;
          addLineClass(startLine.from, minimal ? `cm-rm-min-h${levelNum}` : `cm-rm-h${levelNum}`);
          const text = state.doc.sliceString(node.from, node.to);
          const match = text.match(/^(#{1,6}\s+)/);
          if (match) {
            items.push({
              from: node.from,
              to: node.from + match[1].length,
              deco: minimal
                ? Decoration.replace({ widget: new HeadingBadgeWidget(levelNum) })
                : Decoration.replace({}),
            });
          }
          return;
        }

        // Prevent `text\n---` from looking like a SetextHeading2 when `---` is used as a horizontal rule
        if (node.name === "SetextHeading2") {
          for (let ln = startLine.number; ln < endLine.number; ln++) {
            const line = state.doc.line(ln);
            addLineClass(line.from, "cm-rm-setext-reset");
          }
          return;
        }

        // Horizontal rule is handled uniformly per-line below (including `---` directly under text)
        if (node.name === "HorizontalRule") {
          return;
        }

        // Task list checkbox `[ ]` / `[x]` (both rich & minimal)
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

        // ListMark before TaskMarker (hide `- ` in both modes so checkbox aligns cleanly)
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
            } else if (!minimal) {
              items.push({
                from: node.from,
                to: node.to,
                deco: Decoration.replace({ widget: new BulletWidget() }),
              });
            }
          }
          return;
        }

        // Remaining decorations are Rich-mode only
        if (minimal) return;

        // Quote marker `> `
        if (node.name === "QuoteMark") {
          const after = state.doc.sliceString(node.to, node.to + 1);
          const end = after === " " ? node.to + 1 : node.to;
          items.push({ from: node.from, to: end, deco: Decoration.replace({}) });
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

    // Inline math (`$...$` & single-line `$$...$$`) in both rich & minimal, plus `#tags` in rich mode
    const firstLine = state.doc.lineAt(from).number;
    const lastLine = state.doc.lineAt(to).number;
    for (let ln = firstLine; ln <= lastLine; ln++) {
      if (activeLines.has(ln) || codeBlockLines.has(ln)) continue;
      const line = state.doc.line(ln);

      // Skip fenced math delimiters `$$` (handled by BlockMathField)
      if (line.text.trim() === "$$") continue;

      // Render standalone horizontal rule lines (`---`, `***`, `___`) even when text is directly above/below
      if (HR_LINE_REGEX.test(line.text)) {
        items.push({
          from: line.from,
          to: line.to,
          deco: Decoration.replace({ widget: new HrWidget() }),
        });
        continue;
      }

      const mathSpans: Array<[number, number]> = [];
      DISPLAY_INLINE_MATH_REGEX.lastIndex = 0;
      let dm: RegExpExecArray | null;
      while ((dm = DISPLAY_INLINE_MATH_REGEX.exec(line.text)) !== null) {
        const mFrom = line.from + dm.index;
        const mTo = mFrom + dm[0].length;
        mathSpans.push([mFrom, mTo]);
        items.push({
          from: mFrom,
          to: mTo,
          deco: Decoration.replace({ widget: new InlineMathWidget(dm[1] ?? "", true) }),
        });
      }

      INLINE_MATH_REGEX.lastIndex = 0;
      let im: RegExpExecArray | null;
      while ((im = INLINE_MATH_REGEX.exec(line.text)) !== null) {
        const mFrom = line.from + im.index;
        const mTo = mFrom + im[0].length;
        if (mathSpans.some(([a, b]) => mFrom < b && mTo > a)) continue;
        mathSpans.push([mFrom, mTo]);
        items.push({
          from: mFrom,
          to: mTo,
          deco: Decoration.replace({ widget: new InlineMathWidget(im[1] ?? "", false) }),
        });
      }

      if (!minimal && !line.text.startsWith("#")) {
        INLINE_TAG_REGEX.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = INLINE_TAG_REGEX.exec(line.text)) !== null) {
          const prefixLen = m[1]?.length ?? 0;
          const tagText = m[2] ?? "";
          const raw = tagText.slice(1);
          if ((raw.length === 3 || raw.length === 6) && /^[0-9a-fA-F]+$/.test(raw)) continue;
          const tagFrom = line.from + m.index + prefixLen;
          const tagTo = tagFrom + tagText.length;
          if (mathSpans.some(([a, b]) => tagFrom < b && tagTo > a)) continue;
          items.push({
            from: tagFrom,
            to: tagTo,
            deco: Decoration.mark({ class: "cm-rm-tag" }),
          });
        }
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
 * 3-mode Markdown renderer for CodeMirror 6:
 * - `"rich"`    : Obsidian-style rich inline rendering with constant non-heading line height
 * - `"minimal"` : render-markdown.nvim minimal style (1em colored headings + badge, tables, HR, math, tasks, images)
 * - `"raw"`     : pure syntax-highlighted Markdown source
 */
export function createRenderMarkdownExtension(
  getActiveFilePath: () => string | null,
  getRootDir: () => string | null = () => null,
  renderMode: RenderMode | string = "rich",
  showFrontmatterInEditor = true,
): Extension {
  const mode: RenderMode =
    renderMode === "minimal" || renderMode === "raw" ? renderMode : "rich";

  if (mode === "raw") {
    return showFrontmatterInEditor ? [] : [createHideFrontmatterField()];
  }

  const activeMode: "rich" | "minimal" = mode;
  const inlinePlugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildInlineDecorations(view, activeMode);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = buildInlineDecorations(update.view, activeMode);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );

  const exts: Extension[] = [
    inlinePlugin,
    createBlockMathField(),
    createImagePreviewField(getActiveFilePath, getRootDir),
  ];
  if (!showFrontmatterInEditor) {
    exts.push(createHideFrontmatterField());
  }
  return exts;
}
