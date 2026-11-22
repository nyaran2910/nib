# アーキテクチャ概要

## 設計方針

Nib は「起動の速さ」「自然なマルチウィンドウ」「極上の文字入力体験」を最優先し、重いデータベースや Live Preview ではなく **Rust 集中管理コア + 軽量 WebView ビュー** で構成しています。

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
   | Sidebar + CM6    |        | Sidebar + CM6    |
   +------------------+        +------------------+
```

## エディタ基盤 (CodeMirror 6)

- **Compartment による動的再構成**: Vim モード・Markdown 装飾・ユーザーキーバインド・行番号・プラグイン拡張はすべて `Compartment` で分離されており、`EditorView` を破棄せず即座に切り替えられます。
- **`render-markdown.nvim` 風デコレーション**:
  - カーソルがある行は生の Markdown をそのまま表示します。
  - それ以外の行は見出し・チェックボックス・リスト・引用・インラインコード・コードブロックカード・テーブルを `ViewPlugin`（表示範囲のみ走査）で装飾します。
  - 画像のインラインプレビューは CM6 のブロックウィジェット仕様に合わせて `StateField` で描画します。
- **Vim モード (`@replit/codemirror-vim`)**:
  - `yank` オペレータを拡張し、ヤンクした範囲を一定時間発光させる `TextYankPost` 相当のフィードバックを CM6 `StateEffect` + `Decoration.mark` で実装しています。
  - `:w` で保存、ステータスバーへ `NORMAL / INSERT / VISUAL / V-LINE / V-BLOCK` をリアルタイム通知します。
