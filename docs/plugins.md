# プラグイン・拡張機能 API (`window.nib`)

Nib は Obsidian と VS Code の拡張アーキテクチャを参考に、すべての機能を統一的な **Disposable ベースの Plugin API** として公開しています。

## グローバルエントリポイント

アプリ起動後、`window.nib` に以下が公開されます：

- `window.nib.api`: 名前空間付き `NibPluginAPI`
- `window.nib.registerPlugin(plugin: NibPlugin): Promise<void>`
- `window.nib.unregisterPlugin(pluginId: string): Promise<void>`

すべての登録関数は `Disposable`（`() => void`）を返し、`unregisterPlugin` 時に全リソースが自動解放されます。

## API 名前空間

| 名前空間 | 主なメソッド |
| --- | --- |
| `api.commands` | `register(cmd)`, `execute(id)`, `list()`（Command Palette & Hotkeys 設定へ自動統合） |
| `api.containers` | `register(def)`, `list()`（空 Pane の Container 検索ピッカー・D&D・セッション保存へ自動統合） |
| `api.editor` | `registerExtension(id, cm6Ext)`, `getActiveView()`, `getContent()`, `setContent(text)` |
| `api.workspace` | `getRootDir()`, `getActiveFilePath()`, `openFile(path, line?)`, `getLayout()`, `togglePanel()`, `splitPane()`, `openContainer(kind)`, `on(event, handler)` |
| `api.sessions` | `list()`, `getCurrent()`, `saveSnapshot(name?)`, `restore(id)`, `createNamed(name, fromCurrent?)`, `delete(id)` |
| `api.ui` | `showToast(msg)`, `registerStatusBarItem(item)` |
| `api.config` | `get()`, `update(nextConfig)` |

## イベント一覧 (`api.workspace.on`)

- `"file:open"` `{ path }`
- `"file:save"` `{ path }`
- `"editor:change"` `{ path, content }`
- `"layout:change"` `{ activePaneId, focusedPanel }`
- `"session:switch"` `{ sessionId, name }`
- `"session:save"` `{ sessionId, name }`
- `"config:change"` `{ config }`

## 最小プラグイン例（カスタムコンテナ＋コマンド＋ステータスバー）

```ts
await window.nib?.registerPlugin({
  manifest: {
    id: "my-outline",
    name: "Outline",
    version: "0.1.0",
    main: "main.js",
  },
  activate(api) {
    api.containers.register({
      kind: "my-outline:view",
      title: "Outline",
      keywords: ["outline", "toc", "headings"],
      mount(el, ctx) {
        const render = () => {
          const headings = ctx.api.editor
            .getContent()
            .split("\n")
            .filter((l) => /^#{1,6}\s/.test(l));
          el.textContent = headings.join("\n") || "No headings";
        };
        render();
        return ctx.api.workspace.on("file:open", render);
      },
    });

    api.commands.register({
      id: "my-outline:open",
      title: "Open Outline",
      category: "Outline",
      run: () => api.workspace.openContainer("my-outline:view"),
    });

    api.ui.registerStatusBarItem({
      id: "badge",
      text: "Outline",
      align: "right",
      onClick: () => api.workspace.openContainer("my-outline:view"),
    });
  },
});
```
