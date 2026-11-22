# 設定・コマンド・キーバインド

## 3 層設定アーキテクチャ

同期競合や 1 Vault 制限を避けるため、設定と状態を 3 層に分離しています。

| 層 | 保存先 | 同期 | 用途 |
| --- | --- | --- | --- |
| 1. グローバル設定 | `~/.config/nib/config.toml` | dotfiles 等 | テーマ、UI 表示切替、レンダリング・行番号・表示幅、Vim、Explorer 操作モード、キーバインド、画像保存先 |
| 2. フォルダ固有設定（任意） | `<folder>/.nib/config.toml` | iCloud 同期可 | 存在する場合のみグローバル設定を上書き |
| 3. 端末ローカル状態 | `~/.local/state/nib/state.json` | **同期しない** | サイドパネル開閉、最近開いたパス、最終ファイル |
| 認証情報（端末ローカル） | `~/.local/state/nib/credentials.json` | **同期しない** | Cloudflare R2 API キー（Unix `0600` 権限） |

## 2 カラム設定画面 & キーボード操作

`Cmd+,` で開く設定画面は 2 カラム構成で、開いた瞬間に左上の検索入力へフォーカスが合います。

- 左ナビゲーション: `Ctrl+N` / `Ctrl+P` でセクション移動、`Ctrl+L` で右側の設定項目へ移動。
- 右ペイン: `Ctrl+N` / `Ctrl+P`（または `j`/`k`）で項目移動、`Space` でチェックボックス切替 / 選択肢巡回、`Enter` で入力、`Esc` / `Ctrl+H` で戻る。

## エディタ設定

| キー | 値 | デフォルト |
| --- | --- | --- |
| `editor.render_mode` | `"rich"` / `"minimal"` / `"raw"` | `"rich"` |
| `editor.line_number_mode` | `"relative"` / `"absolute"` / `"off"` | `"relative"` |
| `editor.editor_width` | `"centered"` / `"full"` | `"centered"` |
| `editor.show_frontmatter_in_editor` | `true` / `false` | `true` |
| `editor.vim_mode` | `true` / `false` | `true` |

## Panel トグル＆フォーカス仕様

Left / Right / Bottom Panel のマスターコマンドは以下の 3 状態遷移で統一されています。

1. **閉じているとき** → Panel を開いてフォーカスを移動する。
2. **開いていてフォーカス外** → その Panel へフォーカスを移動する。
3. **開いていてフォーカス中** → その Panel を閉じ、Main Panel へフォーカスを戻す。

## デフォルトコマンド一覧

| Command ID | 説明 | デフォルトキー |
| --- | --- | --- |
| `nib:save` | 現在のノートを保存 | `Mod-s` |
| `nib:new-note` | 新規ノートを作成 | `Mod-n` |
| `nib:new-tab` | 新規空タブを開く | `Mod-t` |
| `nib:close-tab` | 現在のタブを閉じる | `Mod-w` |
| `nib:next-tab` | 次の Container へ切替（`Ctrl+Tab` も常時有効） | `Mod-Shift-]` |
| `nib:prev-tab` | 前の Container へ切替（`Ctrl+Shift+Tab` も常時有効） | `Mod-Shift-[` |
| `nib:split-pane` | アクティブな Pane を分割 | — |
| `nib:new-window` | 新しい独立ウィンドウを開く | `Mod-Shift-n` |
| `nib:open-folder` | フォルダを開く | `Mod-o` |
| `nib:toggle-left-panel` | Left Side Panel トグル＆フォーカス | `Mod-Shift-s` |
| `nib:toggle-right-panel` | Right Side Panel トグル＆フォーカス | `Mod-Shift-.` |
| `nib:toggle-bottom-panel` | Bottom Panel トグル＆フォーカス | `Mod-Shift-b` |
| `nib:focus-explorer` | Explorer Container へフォーカス | —（任意設定） |
| `nib:focus-properties` | Properties Container へフォーカス | —（任意設定） |
| `nib:toggle-vim` | Vim モード / 通常モード切替 | `Mod-Shift-v` |
| `nib:cycle-render-mode` | Render モード巡回 (`rich` → `minimal` → `raw`) | `Mod-Shift-m` |
| `nib:toggle-editor-width` | 表示幅切替 (`centered` ↔ `full`) | — |
| `nib:cycle-line-numbers` | 行番号モード巡回 (`relative` → `absolute` → `off`) | — |
| `nib:open-settings` | 設定画面を開く | `Mod-,` |
| `nib:command-palette` | コマンドパレットを開く | `Mod-Shift-p` |
| `nib:search-omni` | Omni Search | `Mod-k` |
| `nib:search-files` | ファイル名検索 | `Mod-Shift-o` |
| `nib:search-content` | 本文検索 | `Mod-Shift-f` |
| `nib:search-tags` | タグ検索 | `Mod-Shift-t` |
