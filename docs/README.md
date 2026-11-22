# Nib Documentation

Nib は、**macOS / iOS 向けの超軽量・高速なローカルファースト Markdown ノートアプリ**です。

## 目次

1. [アーキテクチャ概要 (`architecture.md`)](./architecture.md)
   - Tauri v2 集中管理型 Rust コア、マルチウィンドウ設計、CodeMirror 6 & Vim 実装
2. [設定・コマンド・キーバインド (`configuration.md`)](./configuration.md)
   - 3 層設定管理、コマンドパレット (`Cmd+P`)、キーバインドのカスタマイズ
3. [4 種類の fzf ファジー検索とタグ管理 (`search.md`)](./search.md)
   - Omni Search / ファイル名検索 / 本文検索 / タグ検索の使い方と仕組み
4. [画像管理・WebP 自動変換・Cloudflare R2 (`images-and-r2.md`)](./images-and-r2.md)
   - WebP 自動変換 ON/OFF、R2 API キー設定、オフラインキャッシュ、参照カウントとゴミ箱
5. [iOS / モバイル対応 (`mobile-ios.md`)](./mobile-ios.md)
   - スマホ向け UI（ドロワー・ボトムバー・Safe Area）、iCloud 同期、Tauri v2 iOS ビルド手順
