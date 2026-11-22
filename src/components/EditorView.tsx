import { createEffect, onCleanup, onMount } from "solid-js";
import { createNibEditor, type NibEditorController } from "../editor/createEditor";
import { pluginRegistry } from "../plugins/registry";
import type { ContainerTab, WindowStore } from "../state/store";

export function EditorView(props: { store: WindowStore; tab: () => ContainerTab }) {
  let hostRef: HTMLDivElement | undefined;
  let controller: NibEditorController | undefined;

  onMount(() => {
    if (!hostRef) return;
    const initialTab = props.tab();

    controller = createNibEditor({
      parent: hostRef,
      initialContent: initialTab.content ?? "",
      config: props.store.config(),
      getStorageConfig: () => props.store.config().storage,
      getActiveFilePath: () => props.tab().path ?? null,
      getRootDir: () => props.store.rootDir(),
      onSave: () => void props.store.saveActiveFile(),
      onQuit: () => void props.store.closeTab(props.tab().id),
      onStatus: (msg) => props.store.showToast(msg),
      onChange: (next) => props.store.onEditorContentChange(next, props.tab().id),
      onCursorChange: (metrics) => {
        if (props.tab().id === props.store.activeEditorId()) {
          props.store.setCursor(metrics);
        }
      },
      onVimModeChange: (mode) => {
        if (props.tab().id === props.store.activeEditorId()) {
          props.store.setVimMode(mode);
        }
      },
    });

    const id = initialTab.id;
    props.store.registerEditorFocus(id, () => controller?.view.focus());

    const unsubPlugins = pluginRegistry.onChange(() => controller?.syncPlugins());
    onCleanup(() => {
      props.store.unregisterEditorFocus(id);
      unsubPlugins();
      controller?.destroy();
    });
  });

  // Sync container switch or external content updates (e.g. PropertiesPanel frontmatter edit)
  let lastTabId = props.tab().id;
  let lastLoadVersion = props.store.fileLoadVersion();
  createEffect(() => {
    const t = props.tab();
    const ver = props.store.fileLoadVersion();
    const switched = t.id !== lastTabId || ver !== lastLoadVersion;
    if (t.id !== lastTabId) {
      props.store.unregisterEditorFocus(lastTabId);
      props.store.registerEditorFocus(t.id, () => controller?.view.focus());
      lastTabId = t.id;
    }
    lastLoadVersion = ver;
    controller?.setContent(t.content ?? "", switched);
  });

  createEffect(() => {
    const line = props.store.pendingJumpLine();
    if (line !== null && props.tab().id === props.store.activeEditorId()) {
      controller?.scrollToLine(line);
      props.store.setPendingJumpLine(null);
    }
  });

  createEffect(() => {
    const cfg = props.store.config();
    controller?.applyConfig(cfg);
  });

  return (
    <div
      class="nib-editor-container"
      onMouseDown={() => {
        const t = props.tab();
        void props.store.selectContainer(t.id, false);
      }}
    >
      <div class="nib-cm-host" ref={hostRef} />
    </div>
  );
}
