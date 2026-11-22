# セッション管理（tmux / tmux-resurrect モデル）

Nib の PC 版は、Rust コアプロセス内に **tmux サーバー相当の `SessionManager`** を内蔵し、`~/.local/state/nib/sessions.json` へ永続化します。

## 2 種類のセッション

| 種類 | 用途 | ライフサイクル |
| --- | --- | --- |
| **通常セッション (`ephemeral`)** | 普段使いの連続した 1 本のセッション | `Cmd+Shift+W`（ウィンドウ終了）や `Cmd+Q` 時に自動保存。リングバッファ（デフォルト 8 件）で古い履歴から自動上書き。 |
| **名前付きセッション (`named`)** | プロジェクトや作業単位で明示的に作成 | **永続保持**（リングバッファで上書きされず、明示的に削除するまで残る）。 |

## 保存される状態

- 開いているルートディレクトリ
- 全 Panel（Left / Center / Right / Bottom）の開閉状態と幅・高さ
- 各 Panel 内の全 Pane と分割比率（`weight`）
- 各 Pane 内の全 Container（Explorer / Properties / プラグインコンテナ / Editor の全タブ・ファイルパス・未保存ドラフト内容）

## 操作・ショートカット

- `Cmd+W` (`nib:close-tab`): アクティブなタブを閉じる
- `Cmd+Shift+W` (`nib:close-window-session`): 現在のセッションを保存してウィンドウを閉じる
- `Cmd+Shift+L` (`nib:sessions`): セッションスイッチャーを開く（各セッション内の Pane / Container / 開いているバッファ一覧を確認して即時復帰・新規名前付きセッション作成・削除）
- `nib:session-save`: 現在の状態を明示的にスナップショット保存（`tmux-resurrect` 相当）
- `nib:session-restore-last`: 直前のセッションへ即復帰
- **自動保存（`tmux-continuum` 相当）**: 設定 → `Sessions` の `Auto-save interval (min)` に分数（例: `15`）を指定すると定期保存されます（`0` = 手動＋終了時のみ）。
