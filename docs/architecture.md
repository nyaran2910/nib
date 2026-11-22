# アーキテクチャ概要

## 設計方針

Nib は「起動の速さ」「自然なマルチウィンドウ」「極上の文字入力体験」を最優先し、重いデータベースではなく **Rust 集中管理コア + 軽量 WebView ビュー** で構成しています。

```text
+-------------------------------------------------------+
|  Tauri v2 Rust Core (プロセス内で 1 インスタンス共有)   |
|  - AppState                                           |
|    - WatcherManager (notify / 参照カウント共有)         |
|    - SearchIndex (fzf 4モード検索 & タグインデックス)    |
|    - ImageRefManager (画像参照カウント & ゴミ箱管理)     |
|    - ConfigManager (3層設定ローダー)                    |
|    - StorageProvider / PublishProvider                |
+-----------+---------------------------+---------------+
            | IPC (invoke / events)     |
   +--------+---------+        +--------+---------+
   | Window 1 (Solid) |        | Window 2 (Solid) |
   +------------------+        +------------------+
```

## 公式 UI ドメイン階層 (Window → Panel → Pane → Container)

Nib の画面構造は以下の 4 階層で統一されています。

1. **Window**: 独立した OS ウィンドウ（`Cmd+Shift+N` で複数起動可能）。
2. **Panel**: Window 内の 4 つの領域。
   - **Main Panel** (`center`): 中央のメイン領域（常時表示）。
   - **Left Side Panel** (`left`): 左パネル（`Cmd+Shift+S`）。
   - **Right Side Panel** (`right`): 右パネル（`Cmd+Shift+.`）。
   - **Bottom Panel** (`bottom`): 下パネル（`Cmd+Shift+B`）。
3. **Pane**: 各 Panel 内の分割領域（tmux 方式）。初期は 1 Pane ですが、任意の Panel 内で複数 Pane へ分割可能です。
4. **Container**: 各 Pane 内にタブとして配置される実体ビュー（`Editor`, `Explorer`, `Properties` など）。`Ctrl+Tab` / `Ctrl+Shift+Tab` でアクティブな Pane 内の Container を切り替え、ドラッグ＆ドロップで別 Pane・別 Panel へ自由に移動できます。

## エディタ基盤 (CodeMirror 6)

- **Compartment による動的再構成**: Vim モード・Markdown レンダリングモード・行番号モード・表示幅・インデント・プラグイン拡張はすべて `Compartment` で分離されており、`EditorView` を破棄せず即座に切り替えられます。
- **3 段階 Markdown レンダリング (`render_mode`)**:
  - `rich`（デフォルト / Obsidian 風）: アクティブ行は生 Markdown、それ以外の行は見出し・チェックボックス・リスト・引用・コードブロック・テーブル・数式 (`$...$` / `$$...$$`)・画像プレビューを装飾。見出し・数式ブロック・画像以外は一定の行高を維持し、カーソル移動時のガタつきを防止します。
  - `minimal`（`render-markdown.nvim` 風）: 見出しも `1em` のまま色＋丸数字バッジ（①〜⑥）で区別し、テーブル・水平線・数式・チェックボックス・画像を描画します。
  - `raw`: 装飾や記号の非表示を行わない純粋なシンタックスハイライト表示。
- **ハイブリッド相対行番号 (`line_number_mode`)**:
  - `relative`（デフォルト / Neovim 風）: 現在行は絶対行番号、その他の行は現在行からの距離（`20k` / `15j` で即ジャンプ可能）を表示。
  - `absolute` / `off` への切り替えに対応。中央表示モードでも行番号ガターはテキスト列のすぐ左に密着します。
- **表示幅モード (`editor_width`)**:
  - `centered`（デフォルト）と `full`（Notion フルページ幅）を切り替え可能。
- **Vim モード (`@replit/codemirror-vim`)**:
  - `TextYankPost` 相当のヤンクハイライト、`:w` / `:q` / `:wq`、ステータスバーへのリアルタイムモード表示を備えます。
