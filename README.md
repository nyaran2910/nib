# Nib

An ultra-lightweight, multi-window, local-first Markdown notes app for **macOS** and **iOS**, built with **Tauri v2** (Rust) + **SolidJS** + **CodeMirror 6**.

## Features

- **Centralized Rust core & instant startup**: Single `AppState` shared across all windows (ref-counted file watching, fzf search index, image ref-counting, 3-layer config).
- **Natural macOS multi-window & CLI launch**: Open any folder or standalone `.md` file (`nib ~/Notes` or `nib README.md`) or spawn independent full windows (`Cmd+Shift+N`).
- **`render-markdown.nvim`-style editing**: Raw Markdown on the active cursor line; crisp headings, clickable checkboxes, bullets, blockquotes, fenced code cards, inline `#tag` pills, and immediate inline image previews (with drag-and-drop & clipboard paste).
- **First-class Vim mode**: Powered by `@replit/codemirror-vim` with `TextYankPost`-equivalent highlight flash (`yy`, `Shift+V` → `y`), text objects, registers, dot repeat, `:w` / `:q` / `:wq`, and seamless toggle to standard mode (`Cmd+Shift+V`).
- **4-mode fzf fuzzy search**: Omni (`Cmd+K`), Files (`Cmd+Shift+O`), Content with line jump (`Cmd+Shift+F`), and Tags (`Cmd+Shift+T`).
- **Obsidian-style Command Palette & searchable Settings**: Every action is a command (`Cmd+P`) and customizable hotkey (`Cmd+,`).
- **Image Storage (WebP toggle + Cloudflare R2)**: Configurable WebP auto-conversion, AWS SigV4 Cloudflare R2 upload, offline local cache fallback, and persisted soft-delete image trash.
- **OS-following Light / Dark Mode & iOS mobile layout**: Adapts natively to macOS/iOS appearance, safe areas, slide-over drawer, and mobile bottom bar.

## Documentation

See [`docs/README.md`](./docs/README.md) for detailed architecture, configuration, search, Cloudflare R2, and iOS build guides.

## Development & Build

```bash
# Install dependencies
pnpm install

# Run Rust unit tests
cd src-tauri && cargo test

# Launch macOS app in dev mode
pnpm tauri dev

# Build production macOS Nib.app bundle
pnpm tauri build --bundles app
```

## License

MIT
