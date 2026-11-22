# iOS / モバイル対応ガイド

Nib は Tauri v2 のデスクトップ・モバイル共通エントリポイント（`#[cfg_attr(mobile, tauri::mobile_entry_point)]`）を採用しており、macOS と iOS で同一の Rust コア・エディタ基盤を共有します。

## スマホ向け UX 最適化

画面幅 `768px` 以下（iPhone / コンパクト幅）では自動でモバイルレイアウトへ切り替わります。

- **Safe Area 対応**: `env(safe-area-inset-top)` / `env(safe-area-inset-bottom)` により Dynamic Island / ノッチ / ホームインジケータを避けて配置されます。
- **スライドイン・ドロワーサイドバー**: ノート選択後に自動でドロワーが閉じ、執筆スペースを最大化します。
- **モバイルボトムアクションバー**: キーボードショートカットが無い環境でも、下部バーからワンタップで以下に素早くアクセスできます。
  - `Files`（ファイルツリー）
  - `Search`（4 モード fzf ファジー検索）
  - `#Tags`（タグ検索）
  - `+ Note`（新規ノート作成）
  - `Cmds`（コマンドパレット）

## iOS での同期方針

- macOS 側は任意のディレクトリや単体 `.md` ファイルを何枚でも独立ウィンドウで開けます。
- iOS 側は iCloud Drive の専用フォルダをホームとして開く運用を前提としており、端末ローカル状態（`state.json`）や R2 API キー（`credentials.json`）は絶対に同期フォルダへ混ぜないため、端末間の設定競合が発生しません。

## iOS ビルド初期化手順（Xcode + Rust 導入後）

```bash
# Rust iOS ターゲットを追加
rustup target add aarch64-apple-ios aarch64-apple-ios-sim

# Tauri v2 iOS プロジェクト生成
pnpm tauri ios init

# iOS シミュレータで起動
pnpm tauri ios dev
```
