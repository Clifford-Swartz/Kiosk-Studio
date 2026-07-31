import { contextBridge, ipcRenderer } from "electron";

/** Mirrors MediaProbeResult in ../main/mediaSupport.ts — kept separate so this
 * file (type-checked from both the node and web tsconfigs) doesn't reach into
 * main/'s ambient module declarations, which the web tsconfig doesn't include. */
interface MediaProbeResult {
  videoCodec: string | null;
  audioCodec: string | null;
  durationSec: number | null;
  supported: boolean | null;
  reason?: string;
}

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
   * Export the current project as a bundled .kproj folder with all assets.
   * Returns the exported project path, or null if canceled.
   */
  exportProject: (projectPath: string, text: string): Promise<string | null> =>
    ipcRenderer.invoke("project:export", projectPath, text),
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
   * Show a content picker (image/video/audio) defaulting to the shared
   * user-content folder. Automatically copies external files into user-content.
   * Resolves to { name, path } (relative path) or null if canceled.
   */
  pickContent: (type: "image" | "video" | "audio" | "media"): Promise<{ name: string; path: string } | null> =>
    ipcRenderer.invoke("content:pick", type),
  /**
   * Copy an external file to the shared user-content folder, preserving its
   * original filename. Handles deduplication with _1, _2 suffixes.
   * Resolves to the relative path (e.g., "user-content/image.jpg").
   */
  copyExternalFile: (externalPath: string): Promise<string> =>
    ipcRenderer.invoke("content:copyExternal", externalPath),
  /**
   * Probe a project-relative video's codecs to detect whether Chromium's
   * <video> element can decode it. `projectPath` may be null for an unsaved
   * project (only "user-content/" paths resolve then).
   */
  probeVideo: (projectPath: string | null, relativePath: string): Promise<MediaProbeResult> =>
    ipcRenderer.invoke("media:probe", projectPath, relativePath),
  /**
   * Re-encode a project-relative video to H.264/AAC mp4. Progress arrives via
   * onEvent as { kind: "encodeProgress", payload: { relativePath, percent } }.
   * Resolves to the new relative path.
   */
  reencodeVideo: (projectPath: string | null, relativePath: string): Promise<string> =>
    ipcRenderer.invoke("media:reencode", projectPath, relativePath),
  /**
   * Show a .pptx open dialog + parse it; resolves to a ParsedDeckWire or
   * null (canceled, or the parse failed — main already showed an error
   * dialog in that case). Typed `unknown` here because IPC gives no runtime
   * guarantee the main process actually returned this shape — validate with
   * `isParsedDeckWire` from @kiosk/pptx before use.
   */
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
  /** Get app root directory (for resolving user-content when no project saved). */
  getAppRoot: (): Promise<string> =>
    ipcRenderer.invoke("app:root"),

  // --- kiosk mode ---
  /** Whether the app launched in kiosk mode (and which project). */
  getKioskInfo: (): Promise<{ kiosk: boolean; projectPath: string | null }> =>
    ipcRenderer.invoke("kiosk:info"),
  /** Leave kiosk/fullscreen (quits a launched kiosk; exits fullscreen for in-app preview). */
  exitKiosk: (): Promise<void> => ipcRenderer.invoke("kiosk:exit"),
  /** Toggle the OS window fullscreen (used by the in-app ▶ Play). */
  setFullscreen: (on: boolean): Promise<void> => ipcRenderer.invoke("window:fullscreen", on),
  /** Subscribe to EventBus-compatible events from main process; returns an unsubscribe. */
  onEvent: (
    cb: (event: { kind: string; payload: Record<string, unknown>; timestamp?: number; sessionId?: string; sceneId?: string }) => void
  ): (() => void) => {
    const handler = (_e: unknown, event: { kind: string; payload: Record<string, unknown>; timestamp?: number; sessionId?: string; sceneId?: string }) =>
      cb(event);
    ipcRenderer.on("event:emit", handler);
    return () => ipcRenderer.removeListener("event:emit", handler);
  },
  /** Write analytics data to file (CSV/JSON/JSONL). */
  writeAnalytics: (path: string, data: string, append: boolean): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("analytics:write", path, data, append),

  // --- AI chat ---
  /** Forward a chat-completions request (messages + tool defs) to the main-process OpenAI proxy. */
  sendChat: (messages: unknown[], tools: unknown[]): Promise<unknown> =>
    ipcRenderer.invoke("ai:chat", messages, tools),
  /** Whether an API key is currently configured (never returns the raw key). */
  hasAiKey: (): Promise<boolean> => ipcRenderer.invoke("ai:getKey"),
  /** Save the OpenAI API key (stored via electron-store in the main process). */
  setAiKey: (key: string): Promise<void> => ipcRenderer.invoke("ai:setKey", key),
};

export type KioskApi = typeof api;

contextBridge.exposeInMainWorld("kiosk", api);
