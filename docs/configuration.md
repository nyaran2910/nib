# 設定・コマンド・キーバインド

## 3 層設定アーキテクチャ

同期競合や 1 Vault 制限を避けるため、設定と状態を 3 層に分離しています。

| 層 | 保存先 | 同期 | 用途 |
| --- | --- | --- | --- |
| 1. グローバル設定 | `~/.config/nib/config.toml` | dotfiles 等 | テーマ、UI 表示切替、フォント、Vim、Explorer 操作モード、キーバインド、画像保存先 |
| 2. フォルダ固有設定（任意） | `<folder>/.nib/config.toml` | iCloud 同期可 | 存在する場合のみグローバル設定を上書き |
| 3. 端末ローカル状態 | `~/.local/state/nib/state.json` | **同期しない** | サイドバー開閉、最近開いたパス、最終ファイル |
| 認証情報（端末ローカル） | `~/.local/state/nib/credentials.json` | **同期しない** | Cloudflare R2 API キー（Unix `0600` 権限） |

## 2 カラム設定画面 & リアルタイム検索

`Cmd+,` で開く設定画面は Obsidian 風の 2 カラムレイアウトで、開いた瞬間に左上の検索入力へフォーカスが合います。`Ctrl+N` / `Ctrl+P` でセクション移動も可能です。

- **UI & Chrome**: トップバー全体・Search・Render・Vim・コマンドパレット・新規ウィンドウ・設定ボタン・下部ステータスバー・サイドバー検索欄をすべて個別に表示/非表示切替可能。
- **Explorer**: Snacks.nvim 風の **Vim モード**（`hjkl`, `o`, `Tab`, `m`, `c`, `d`, `a`/`A`）と **Emacs モード**（`Ctrl+N/P/F/B`, `Ctrl+G`）を選択可能。

## Obsidian 風コマンド & キーバインド設計

Nib ではすべての操作が **Command** として `PluginRegistry` に登録されています。

- **コマンドパレット (`Cmd+Shift+P`)**: 登録されているすべてのコマンドをファジー検索して実行できます。
- **キーバインドの自由な変更**: 設定画面の `Hotkeys & Commands` または `~/.config/nib/config.toml` の `[keybindings]` から任意のショートカットに変更できます。

### デフォルトコマンド一覧

| Command ID | 説明 | デフォルトキー |
| --- | --- | --- |
| `nib:save` | 現在のノートを保存 | `Mod-s` |
| `nib:new-note` | 新規ノートを作成 | `Mod-n` |
| `nib:new-window` | 新しい独立ウィンドウを開く | `Mod-Shift-n` |
| `nib:open-folder` | フォルダを開く | `Mod-o` |
| `nib:toggle-sidebar` | サイドバー開閉（フォーカス移動なし） | `Mod-Shift-s` |
| `nib:focus-explorer` | Explorer へフォーカス / 再押下でエディタへ戻る | `Mod-Ctrl-1` |
| `nib:focus-properties` | Frontmatter Properties へフォーカス / 戻る | `Mod-Ctrl-2` |
| `nib:toggle-topbar` | トップバー表示切替 | — |
| `nib:toggle-statusbar` | ステータスバー表示切替 | — |
| `nib:toggle-vim` | Vim モード / 通常モード切替 | `Mod-Shift-v` |
| `nib:toggle-render-markdown` | Markdown インライン装飾切替 | `Mod-Shift-m` |
| `nib:open-settings` | 設定画面を開く（検索欄へ即フォーカス） | `Mod-,` |
| `nib:command-palette` | コマンドパレットを開く | `Mod-Shift-p` |
| `nib:search-omni` | Omni Search（総合ファジー検索） | `Mod-k` |
| `nib:search-files` | ファイル名ファジー検索 | `Mod-Shift-o` |
| `nib:search-content` | 本文ファジー検索 | `Mod-Shift-f` |
| `nib:search-tags` | タグファジー検索 & 絞り込み | `Mod-Shift-t` |
