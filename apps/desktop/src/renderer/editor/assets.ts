import type {} from "../../preload/api.js";
import { useEditor } from "./store.js";
import { useEffect, useState } from "react";

/**
 * Base URL for resolving a project's relative asset paths. Uses the custom
 * `kioskasset://` scheme (served by the main process) rather than file://, so
 * images load in dev (renderer is http://localhost) as well as production.
 * The directory is encoded as one segment; resolveSrc appends "assets/<name>",
 * and the main handler decodeURIComponent's the whole pathname.
 *
 * When no project file is saved yet, falls back to app root for user-content/ assets.
 */
let cachedAppRoot: string | null = null;

export async function getAppRootCached(): Promise<string> {
  if (cachedAppRoot === null) {
    const root = await window.kiosk.getAppRoot();
    cachedAppRoot = root ?? "";
  }
  return cachedAppRoot ?? "";
}

/**
 * React hook version of projectAssetBase - returns stable value that updates
 * when app root cache warms. Use in Canvas/Player components.
 */
export function useProjectAssetBase(filePath: string | null): string | undefined {
  const [appRoot, setAppRoot] = useState(cachedAppRoot);

  useEffect(() => {
    if (cachedAppRoot === null) {
      getAppRootCached().then(setAppRoot);
    }
  }, []);

  // Saved project: base on the project's own .kproj dir (assets/ lives beside
  // project.json there), so main's kproj-boundary resolution actually fires.
  // Unsaved project: fall back to app root for shared user-content/ assets.
  const base = filePath ? dirnameFilePath(filePath) : appRoot;
  return base ? `kioskasset://load/${encodeURIComponent(base)}/` : undefined;
}

/**
 * Sync version for non-React contexts (exports, protocol handler).
 */
export function projectAssetBase(filePath: string | null): string | undefined {
  const base = filePath ? dirnameFilePath(filePath) : cachedAppRoot;
  return base ? `kioskasset://load/${encodeURIComponent(base)}/` : undefined;
}

/** Directory containing the project file, in either \ or / separated paths. */
function dirnameFilePath(filePath: string): string {
  const idx = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return idx >= 0 ? filePath.slice(0, idx) : filePath;
}

/**
 * Shared image-input helpers used by the Canvas (paste/drop) and the Properties
 * panel (Choose image…). They funnel everything through the same pipeline:
 *   ensure the project is saved (assets/ needs a folder) → write bytes via IPC
 *   → return the relative "assets/<name>" path to store in the element src.
 */

/**
 * Ensure the project has a save location so assets have a home. If it already
 * has one, return it immediately. Otherwise SILENTLY create a workspace folder
 * (no dialog) and remember it — so adding images never interrupts the user. The
 * user can relocate later via Save As. Returns the project file path.
 */
export async function ensureProjectSaved(): Promise<string | null> {
  const { filePath, project, markSaved } = useEditor.getState();
  if (filePath) return filePath;
  const text = JSON.stringify(project, null, 2);
  const path = await window.kiosk.ensureWorkspace(text, project.name || "Untitled");
  if (path) markSaved(path);
  return path;
}

/** Read a Blob/File as base64 (no data: prefix). */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string; // "data:...;base64,XXXX"
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Persist an image File/Blob into the project's assets/ folder. Prompts to save
 * the project first if needed. Returns the relative "assets/<name>" path, or
 * null if the user canceled the save prompt.
 */
export async function importImageBlob(blob: Blob, suggestedName: string): Promise<string | null> {
  const projectPath = await ensureProjectSaved();
  if (!projectPath) return null;
  const base64 = await blobToBase64(blob);
  return window.kiosk.saveAsset(projectPath, suggestedName, base64);
}

/**
 * Import content (image, video, audio, or media for both image/video) from the shared
 * user-content folder or copy from an external location. Returns the relative path to
 * the file, or null if canceled.
 */
export async function importContentFile(
  type: "image" | "video" | "audio" | "media"
): Promise<string | null> {
  const picked = await window.kiosk.pickContent(type);
  if (!picked) return null;
  return picked.path;
}

/**
 * Persist an image chosen via the native picker (already base64) into assets/.
 * Returns the relative path, or null if canceled.
 */
export async function importPickedImage(
  picked: { name: string; base64: string }
): Promise<string | null> {
  const projectPath = await ensureProjectSaved();
  if (!projectPath) return null;
  return window.kiosk.saveAsset(projectPath, picked.name, picked.base64);
}

/**
 * Import an image from a file path. If the file is outside the user-content folder,
 * it will be copied there automatically. Returns the relative path, or null if
 * the project is not saved.
 */
export async function importImageFromPath(filePath: string): Promise<string | null> {
  const projectPath = await ensureProjectSaved();
  if (!projectPath) return null;
  return window.kiosk.copyExternalFile(filePath);
}

/**
 * Validate an audio file based on extension. Returns { valid: true } if ok,
 * or { valid: false, error: string } if validation fails.
 */
export function validateAudioFile(filePath: string): { valid: true } | { valid: false; error: string } {
  const ext = filePath.toLowerCase().split(".").pop() || "";
  const supportedExts = ["mp3", "wav", "ogg", "m4a", "flac"];

  if (!supportedExts.includes(ext)) {
    return { valid: false, error: `Unsupported format (.${ext}). Supported: ${supportedExts.join(", ")}` };
  }

  return { valid: true };
}
