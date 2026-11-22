import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { uploadPastedImage, type StorageConfig } from "../state/ipc";

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function convertToWebP(file: File, quality: number): Promise<{ blob: Blob; mime: string }> {
  try {
    const objectUrl = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("Failed to decode image"));
        el.src = objectUrl;
      });

      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return { blob: file, mime: file.type || "image/png" };
      }
      ctx.drawImage(img, 0, 0);

      const webpBlob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/webp", Math.min(1, Math.max(0.1, quality / 100))),
      );
      if (webpBlob && webpBlob.type === "image/webp") {
        return { blob: webpBlob, mime: "image/webp" };
      }
      return { blob: file, mime: file.type || "image/png" };
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    return { blob: file, mime: file.type || "image/png" };
  }
}

export interface ImagePasteOptions {
  getStorageConfig: () => StorageConfig;
  getActiveFilePath: () => string | null;
  getRootDir: () => string | null;
  onStatus?: (message: string) => void;
}

async function processImageFiles(
  files: File[],
  view: EditorView,
  options: ImagePasteOptions,
  insertPos?: number,
): Promise<void> {
  const cfg = options.getStorageConfig();
  for (const file of files) {
    try {
      options.onStatus?.("Processing image...");
      const shouldConvert =
        cfg.auto_convert_webp &&
        file.type !== "image/webp" &&
        file.type !== "image/svg+xml" &&
        file.type !== "image/gif";

      const payload = shouldConvert
        ? await convertToWebP(file, cfg.webp_quality)
        : { blob: file, mime: file.type || "image/png" };

      const base64 = await blobToBase64(payload.blob);
      const rawName = (file.name || "pasted-image").replace(/\.[^.]+$/, "");
      const stem = rawName || "pasted-image";
      const asset = await uploadPastedImage(
        stem,
        payload.mime,
        base64,
        options.getActiveFilePath(),
        options.getRootDir(),
      );

      const markdownLink = `![${stem}](${asset.url})`;
      const sel = view.state.selection.main;
      const from = insertPos ?? sel.from;
      const to = insertPos ?? sel.to;
      view.dispatch({
        changes: { from, to, insert: markdownLink },
        selection: { anchor: from + markdownLink.length },
      });

      options.onStatus?.(
        asset.synced
          ? `Uploaded to R2 (${payload.mime.replace("image/", "")})`
          : `Saved to ${asset.url}`,
      );
    } catch (err) {
      console.error("Failed to insert image:", err);
      options.onStatus?.(`Image insert failed: ${String(err)}`);
    }
  }
}

/**
 * Handles both clipboard paste AND drag-and-drop of images directly into CodeMirror 6.
 * Respects `storage.auto_convert_webp` and `storage.webp_quality`, then delegates to Rust `StorageProvider`.
 */
export function createImagePasteExtension(options: ImagePasteOptions): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const items = event.clipboardData?.items;
      const filesList = event.clipboardData?.files;

      const imageFiles: File[] = [];
      if (items) {
        for (const item of Array.from(items)) {
          if (item.kind === "file" && item.type.startsWith("image/")) {
            const f = item.getAsFile();
            if (f) imageFiles.push(f);
          }
        }
      }
      if (imageFiles.length === 0 && filesList) {
        for (const f of Array.from(filesList)) {
          if (f.type.startsWith("image/")) {
            imageFiles.push(f);
          }
        }
      }

      if (imageFiles.length === 0) return false;
      event.preventDefault();
      void processImageFiles(imageFiles, view, options);
      return true;
    },
    dragover(event) {
      if (event.dataTransfer?.types.includes("Files")) {
        event.preventDefault();
        return true;
      }
      return false;
    },
    drop(event, view) {
      const filesList = event.dataTransfer?.files;
      if (!filesList || filesList.length === 0) return false;
      const imageFiles = Array.from(filesList).filter((f) => f.type.startsWith("image/"));
      if (imageFiles.length === 0) return false;

      event.preventDefault();
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? undefined;
      void processImageFiles(imageFiles, view, options, pos);
      return true;
    },
  });
}
