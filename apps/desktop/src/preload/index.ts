import { contextBridge, ipcRenderer } from "electron";

/**
 * The single, typed bridge between the sandboxed renderer and the Node main
 * process. Every privileged capability (file access, connectors later) is
 * funneled through here. Keep the surface small and explicit.
 */
const api = {
  /** Load project JSON text by path; omit path to load the bundled example. */
  loadProject: (path?: string): Promise<string> =>
    ipcRenderer.invoke("project:load", path),
  /** Show an open dialog; resolves to the chosen path or null if canceled. */
  pickProject: (): Promise<string | null> =>
    ipcRenderer.invoke("project:pick"),
  /**
   * Write project JSON text; omit path to show a Save dialog. Resolves to the
   * path written, or null if canceled.
   */
  saveProject: (text: string, path?: string): Promise<string | null> =>
    ipcRenderer.invoke("project:save", text, path),
  /**
   * Silently create a workspace folder + project.json for an unsaved project
   * (no dialog) so assets have a home. Returns the new project path.
   */
  ensureWorkspace: (text: string, projectName: string): Promise<string> =>
    ipcRenderer.invoke("project:ensureWorkspace", text, projectName),
  /**
   * Copy image bytes (base64) into the project's assets/ folder; resolves to
   * the relative path ("assets/<name>") to store in the element's src.
   */
  saveAsset: (projectPath: string, name: string, base64: string): Promise<string> =>
    ipcRenderer.invoke("assets:save", projectPath, name, base64),
  /** Show an image open dialog; resolves to { name, base64 } or null. */
  pickImage: (): Promise<{ name: string; base64: string } | null> =>
    ipcRenderer.invoke("assets:pick"),
  /**
   * Show a content picker (image/video/audio) defaulting to the project's
   * user-content folder. Automatically copies external files into user-content.
   * Resolves to { name, path } (relative path) or null if canceled.
   */
  pickContent: (projectPath: string, type: "image" | "video" | "audio"): Promise<{ name: string; path: string } | null> =>
    ipcRenderer.invoke("content:pick", projectPath, type),
  /**
   * Copy an external file to the project's user-content folder, preserving its
   * original filename. Handles deduplication with _1, _2 suffixes.
   * Resolves to the relative path (e.g., "user-content/image.jpg").
   */
  copyExternalFile: (projectPath: string, externalPath: string): Promise<string> =>
    ipcRenderer.invoke("content:copyExternal", projectPath, externalPath),
  /** Show a .pptx open dialog + parse it; resolves to a ParsedDeck or null. */
  importPptx: (): Promise<unknown | null> => ipcRenderer.invoke("pptx:import"),

  // --- live data ---
  /** Start a live data session for the given data sources. */
  startData: (sources: { id: string; kind: string; config: Record<string, unknown> }[]): Promise<void> =>
    ipcRenderer.invoke("data:start", sources),
  /** Stop the live data session. */
  stopData: (): Promise<void> => ipcRenderer.invoke("data:stop"),
  /** Primary display resolution, for the "Match this display" scene preset. */
  getDisplaySize: (): Promise<{ width: number; height: number }> =>
    ipcRenderer.invoke("display:size"),

  // --- kiosk mode ---
  /** Whether the app launched in kiosk mode (and which project). */
  getKioskInfo: (): Promise<{ kiosk: boolean; projectPath: string | null }> =>
    ipcRenderer.invoke("kiosk:info"),
  /** Leave kiosk/fullscreen (quits a launched kiosk; exits fullscreen for in-app preview). */
  exitKiosk: (): Promise<void> => ipcRenderer.invoke("kiosk:exit"),
  /** Toggle the OS window fullscreen (used by the in-app ▶ Play). */
  setFullscreen: (on: boolean): Promise<void> => ipcRenderer.invoke("window:fullscreen", on),
  /** Subscribe to pushed connector values; returns an unsubscribe. */
  onDataValue: (
    cb: (value: { sourceId: string; value: unknown; at: number }) => void
  ): (() => void) => {
    const handler = (_e: unknown, value: { sourceId: string; value: unknown; at: number }) =>
      cb(value);
    ipcRenderer.on("data:value", handler);
    return () => ipcRenderer.removeListener("data:value", handler);
  },
};

export type KioskApi = typeof api;

contextBridge.exposeInMainWorld("kiosk", api);
