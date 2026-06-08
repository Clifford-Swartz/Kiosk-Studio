import { useEditor } from "./store.js";

/**
 * Base URL for resolving a project's relative asset paths. Uses the custom
 * `kioskasset://` scheme (served by the main process) rather than file://, so
 * images load in dev (renderer is http://localhost) as well as production.
 * The directory is encoded as one segment; resolveSrc appends "assets/<name>",
 * and the main handler decodeURIComponent's the whole pathname.
 */
export function projectAssetBase(filePath: string | null): string | undefined {
  if (!filePath) return undefined;
  const dir = filePath.replace(/\\/g, "/").replace(/\/[^/]*$/, "");
  return `kioskasset://load/${encodeURIComponent(dir)}/`;
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
