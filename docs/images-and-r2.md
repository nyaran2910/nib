# 画像管理・WebP 自動変換・Cloudflare R2

ローカルの Markdown フォルダだけで完結する Git フレンドリーな保存方式と、Cloudflare R2 へのクラウド保存を選択できます。

## 保存先の選択

設定画面 (`Cmd+,`) → **Image Storage** で選択できます：

1. **Local Folder (`./images` — デフォルト)**
   - 編集中の Markdown ファイルと同じフォルダ配下に `images/`（サブフォルダ名は設定変更可能）を作成して画像を保存し、`![name](./images/xxx.webp)` として埋め込みます。
   - キャッシュディレクトリ等に逃げないため、フォルダごとそのまま Git 管理できます。
2. **Cloudflare R2**
   - ドロップダウンで `Cloudflare R2` を選択した時のみ R2 設定欄が表示されます。

## WebP 自動変換の ON / OFF

```toml
[storage]
provider = "local_folder" # "local_folder" または "r2"
local_images_dir = "images"
auto_convert_webp = true  # ペースト・ドロップ時の WebP 自動変換 ON/OFF
webp_quality = 82         # 1〜100
trash_retention_days = 30
```

- **ON (`true`)**: スクショや写真などを WebP に圧縮して容量を大幅に削減します（GIF / SVG はそのまま保持）。
- **OFF (`false`)**: 元の画像フォーマット（PNG / JPEG 等）のまま保存・アップロードします。

## Cloudflare R2 のセットアップ手順

1. Cloudflare ダッシュボードで R2 バケットを作成し、**R2 API Token**（Object Read & Write 権限）を発行して以下を取得します。
   - Account ID / Bucket Name / Access Key ID / Secret Access Key / （任意）Public Base URL
2. Nib の設定画面 (`Cmd+,`) → **Image Storage** → **Cloudflare R2** を選び、各項目を入力します。
   - `Access Key ID` と `Secret Access Key` は **端末ローカルの `~/.local/state/nib/credentials.json`（パーミッション `0600`）** にのみ保存され、`config.toml` や iCloud 同期フォルダには一切出力されません。
3. 以降はペーストまたはドラッグ＆ドロップするだけで、アプリ側が自動で AWS SigV4 署名付き PUT で R2 へアップロードし、`![name](https://...)` を挿入します。

## 参照カウントとソフトデリートゴミ箱

- ノート保存時に Rust 側の `ImageRefManager` が画像参照カウントを再計算し、参照が 0 になった画像は `~/.local/state/nib/trash.json` にソフトデリート登録されます（デフォルト 30 日保持、設定画面から `Purge Expired` で期限切れを即時整理可能）。
