import { app, BrowserWindow, ipcMain, dialog, protocol, net, webContents, screen, Menu } from "electron";
import { getConnectorFactory, type Connector, type ConnectorValue, type SourceSpec } from "@kiosk/connectors";
import { parsePptx } from "@kiosk/pptx";
import { appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, dirname, extname, join, normalize, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Custom protocol for serving project assets. Using file:// directly fails in
 * dev because the renderer is served from http://localhost (cross-origin), so
 * we route asset loads through a privileged scheme that works identically in
 * dev and production. URL shape: kioskasset://load/<uri-encoded-abs-path>.
 */
const ASSET_SCHEME = "kioskasset";
const BUNDLED_SCHEME = "app";

protocol.registerSchemesAsPrivileged([
  { scheme: ASSET_SCHEME, privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true } },
  { scheme: BUNDLED_SCHEME, privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true } },
]);

// Bundled as CommonJS (see electron.vite.config.ts), so __dirname is the
// Node global pointing at out/main/.

// Crash diagnostics: when launched headlessly (e.g. Playwright), stderr can be
// lost, so mirror fatal errors to a file next to the bundle.
function logFatal(label: string, err: unknown): void {
  try {
    appendFileSync(
      join(__dirname, "main-crash.log"),
      `[${new Date().toISOString()}] ${label}: ${
        err instanceof Error ? err.stack : String(err)
      }\n`
    );
  } catch {
    /* best effort */
  }
}
process.on("uncaughtException", (e) => logFatal("uncaughtException", e));
process.on("unhandledRejection", (e) => logFatal("unhandledRejection", e));

/** Path to the bundled example project used until the editor can save one. */
function defaultProjectPath(): string {
  if (app.isPackaged) {
    // Bundled via electron-builder extraResources -> resources/examples/...
    return join(process.resourcesPath, "examples", "hello.kproj", "project.json");
  }
  // Dev: out/main/index.js -> repo root is four levels up.
  const repoRoot = resolve(__dirname, "..", "..", "..", "..");
  return join(repoRoot, "examples", "hello.kproj", "project.json");
}

/**
 * Parse `--kiosk <project.json>` from argv. In a packaged app argv is
 * [exe, ...args]; in dev electron is launched as [electron, appDir, ...args].
 * We just scan for the flag and take the next token as the project path.
 */
function parseKioskArg(): string | null {
  const argv = process.argv;
  const i = argv.indexOf("--kiosk");
  if (i === -1) return null;
  return argv[i + 1] ?? defaultProjectPath();
}
const KIOSK_PROJECT = parseKioskArg();
const IS_KIOSK = KIOSK_PROJECT !== null;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: "#000000",
    show: false,
    // Kiosk launch: borderless fullscreen, no menu.
    ...(IS_KIOSK ? { fullscreen: true, kiosk: true, frame: false, autoHideMenuBar: true } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once("ready-to-show", () => win.show());

  if (IS_KIOSK) {
    // Suppress reload / devtools / close shortcuts so a public kiosk can't be
    // poked out of its experience. The renderer's exit gesture calls kiosk:exit.
    win.webContents.on("before-input-event", (event, input) => {
      const k = input.key.toLowerCase();
      const blocked =
        k === "f5" ||
        (input.control && (k === "r" || k === "w" || k === "shift" /* devtools combos */)) ||
        (input.control && input.shift && (k === "i" || k === "j" || k === "c")) ||
        (input.alt && k === "f4");
      if (blocked) event.preventDefault();
    });
    win.webContents.on("context-menu", (e) => e.preventDefault());
  }

  // electron-vite injects the dev server URL in development.
  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devUrl) {
    void win.loadURL(devUrl);
    if (!IS_KIOSK) win.webContents.openDevTools({ mode: "detach" });
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

/**
 * Load and return the raw JSON text of a project file. If no path is given,
 * loads the bundled example. Validation happens in the renderer via the
 * engine's Zod schema, so the contract lives in one place. Silently ensures
 * the user-content folder exists for the project.
 */
async function loadProject(_e: unknown, projectPath?: string): Promise<string> {
  const path = projectPath ?? defaultProjectPath();
  const text = await readFile(path, "utf8");
  // Touch pathToFileURL so asset-relative resolution can be added later.
  void pathToFileURL(path);
  // Ensure user-content folder exists for this project.
  await ensureUserContentFolder(path).catch(() => {
    /* best effort; if it fails, the user will get an error when trying to add content */
  });
  return text;
}

async function pickProject(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: "Open Kiosk project",
    properties: ["openFile"],
    filters: [{ name: "Kiosk project", extensions: ["json"] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0]!;
}

/** Sanitize a project name into a safe folder segment. */
function safeFolderName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9 _-]/g, "").trim().slice(0, 60);
  return cleaned || "Untitled";
}

/**
 * Silently establish a workspace folder for a not-yet-saved project so assets
 * have a home — no dialog. Creates Documents/KioskStudio/<name>-<rand>/ with the
 * project.json inside, and returns that path. Used the first time an asset is
 * added; the user can later Save As to relocate.
 */
async function ensureWorkspace(
  _e: unknown,
  text: string,
  projectName: string
): Promise<string> {
  const base = join(app.getPath("documents"), "KioskStudio");
  const folder = `${safeFolderName(projectName)}-${randomBytes(3).toString("hex")}`;
  const dir = join(base, folder);
  await mkdir(dir, { recursive: true });
  const path = join(dir, "project.json");
  await writeFile(path, text, "utf8");
  return path;
}

/**
 * Write project JSON to disk. If no path is given, show a Save dialog. Returns
 * the path written to, or null if the user canceled. The renderer serializes
 * the (already schema-valid) project, so we just persist the text.
 */
async function saveProject(
  _e: unknown,
  text: string,
  projectPath?: string
): Promise<string | null> {
  let path = projectPath;
  if (!path) {
    const result = await dialog.showSaveDialog({
      title: "Save Kiosk project",
      defaultPath: "project.json",
      filters: [{ name: "Kiosk project", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return null;
    path = result.filePath;
  }
  await writeFile(path, text, "utf8");
  return path;
}

/** Get the absolute path to the user-content folder for a project. */
function getUserContentFolderPath(projectPath: string): string {
  return join(dirname(projectPath), "user-content");
}

/** Ensure the user-content folder exists. */
async function ensureUserContentFolder(projectPath: string): Promise<string> {
  const dir = getUserContentFolderPath(projectPath);
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Check if a file path is inside the user-content folder. */
function isFileInUserContentFolder(filePath: string, projectPath: string): boolean {
  const resolved = resolve(filePath);
  const contentDir = resolve(getUserContentFolderPath(projectPath));
  return resolved.startsWith(contentDir + sep);
}

/**
 * Copy a file to the user-content folder, preserving the original filename.
 * If a file with that name already exists, appends _1, _2, etc. to the filename.
 * Returns the relative path (e.g., "user-content/image.jpg").
 */
async function copyToUserContent(
  projectPath: string,
  sourcePath: string
): Promise<string> {
  const contentDir = await ensureUserContentFolder(projectPath);
  const fileName = basename(sourcePath);

  let targetPath = join(contentDir, fileName);
  let finalName = fileName;

  // Deduplicate: if file exists, append _1, _2, etc.
  if (await fileExists(targetPath)) {
    const ext = extname(fileName);
    const base = fileName.slice(0, -ext.length);
    let i = 1;
    while (await fileExists(join(contentDir, `${base}_${i}${ext}`))) {
      i++;
    }
    finalName = `${base}_${i}${ext}`;
    targetPath = join(contentDir, finalName);
  }

  const buf = await readFile(sourcePath);
  await writeFile(targetPath, buf);

  return `user-content/${finalName}`;
}

/** Check if a file exists without throwing. */
async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path, { flag: "r" });
    return true;
  } catch {
    return false;
  }
}

/** Normalize an extension from a filename, defaulting to .png. */
function imageExt(name: string): string {
  const ext = extname(name).toLowerCase();
  return /^\.(png|jpe?g|gif|webp|svg|bmp|avif)$/.test(ext) ? ext : ".png";
}

/**
 * Copy image bytes into the project's assets/ folder and return the relative
 * path ("assets/<name>") to store in the element's src. `base64` is the raw
 * file contents (no data: prefix). The project must already be saved so we
 * know where assets/ lives.
 */
async function saveAsset(
  _e: unknown,
  projectPath: string,
  suggestedName: string,
  base64: string
): Promise<string> {
  const dir = dirname(projectPath);
  const assetsDir = join(dir, "assets");
  await mkdir(assetsDir, { recursive: true });
  const name = `img-${randomBytes(4).toString("hex")}${imageExt(suggestedName)}`;
  await writeFile(join(assetsDir, name), Buffer.from(base64, "base64"));
  return `assets/${name}`;
}

/**
 * Show a content picker dialog (image, video, or audio) defaulting to the
 * project's user-content folder. Returns the chosen file's name and relative path,
 * or null if canceled. If the file is outside the user-content folder, copies it in first.
 */
async function pickContent(
  _e: unknown,
  projectPath: string,
  type: "image" | "video" | "audio"
): Promise<{ name: string; path: string } | null> {
  const filterMap: Record<string, string[]> = {
    image: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"],
    video: ["mp4", "webm"],
    audio: ["mp3", "wav", "ogg"],
  };

  const contentDir = getUserContentFolderPath(projectPath);
  const result = await dialog.showOpenDialog({
    title: `Choose ${type}`,
    defaultPath: contentDir,
    properties: ["openFile"],
    filters: [{ name: type.charAt(0).toUpperCase() + type.slice(1), extensions: filterMap[type]! }],
  });

  if (result.canceled || result.filePaths.length === 0) return null;

  const filePath = result.filePaths[0]!;
  const fileName = basename(filePath);

  // If file is already in the user-content folder, use it directly.
  if (isFileInUserContentFolder(filePath, projectPath)) {
    return { name: fileName, path: `user-content/${fileName}` };
  }

  // Otherwise, copy it to user-content folder.
  const relativePath = await copyToUserContent(projectPath, filePath);
  return { name: fileName, path: relativePath };
}

/**
 * Copy an external file to the user-content folder, preserving its original filename.
 * Returns the relative path (e.g., "user-content/image.jpg").
 */
async function copyExternalFile(
  _e: unknown,
  projectPath: string,
  externalFilePath: string
): Promise<string> {
  if (isFileInUserContentFolder(externalFilePath, projectPath)) {
    return `user-content/${basename(externalFilePath)}`;
  }
  return copyToUserContent(projectPath, externalFilePath);
}

/**
 * Show an image open dialog; read the chosen file and return its name + base64
 * contents so the renderer can hand it back to saveAsset. Null if canceled.
 */
async function pickImage(): Promise<{ name: string; base64: string } | null> {
  const result = await dialog.showOpenDialog({
    title: "Choose image",
    properties: ["openFile"],
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0]!;
  const buf = await readFile(filePath);
  return { name: filePath, base64: buf.toString("base64") };
}

/**
 * Show a .pptx open dialog, parse it, and return the deck with image bytes
 * base64-encoded (for IPC). Null if canceled. Heavy parse runs here in Node.
 */
async function importPptx(): Promise<unknown | null> {
  const result = await dialog.showOpenDialog({
    title: "Import PowerPoint",
    properties: ["openFile"],
    filters: [{ name: "PowerPoint", extensions: ["pptx"] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const buf = await readFile(result.filePaths[0]!);
  const deck = parsePptx(new Uint8Array(buf));
  // Serialize image bytes as base64 so they survive the IPC boundary.
  return {
    slideW: deck.slideW,
    slideH: deck.slideH,
    slides: deck.slides.map((s) => ({
      texts: s.texts,
      images: s.images.map((im) => ({
        x: im.x, y: im.y, width: im.width, height: im.height, ext: im.ext,
        base64: Buffer.from(im.bytes).toString("base64"),
      })),
    })),
  };
}

// --- Connector host -------------------------------------------------------
// Runs one connector per active data source (in this Node process) and forwards
// each emitted value to the renderer that requested the live session. Only one
// session at a time (the editor or player window); starting again replaces it.

let activeConnectors: Connector[] = [];
let liveWebContentsId: number | null = null;

async function stopData(): Promise<void> {
  const conns = activeConnectors;
  activeConnectors = [];
  liveWebContentsId = null;
  await Promise.all(conns.map((c) => Promise.resolve(c.stop()).catch(() => {})));
}

async function startData(e: Electron.IpcMainInvokeEvent, sources: SourceSpec[]): Promise<void> {
  await stopData();
  liveWebContentsId = e.sender.id;
  const emit = (v: ConnectorValue) => {
    const wc = liveWebContentsId != null ? webContents.fromId(liveWebContentsId) : null;
    if (wc && !wc.isDestroyed()) wc.send("data:value", v);
  };
  for (const spec of sources) {
    const factory = getConnectorFactory(spec.kind);
    if (!factory) continue;
    const conn = factory(spec, emit);
    activeConnectors.push(conn);
    try {
      await conn.start();
    } catch {
      /* a bad source shouldn't kill the session */
    }
  }
}

app.whenReady().then(() => {
  // No default application menu — the editor has its own TopBar and a kiosk
  // must show no chrome. This removes the File/Edit/View/Window/Help bar.
  Menu.setApplicationMenu(null);

  // Serve project assets via the privileged scheme. The pathname is a
  // uri-encoded absolute file path; stream it back. Constrain to existing
  // files only (net.fetch of a file URL handles missing files as errors).
  protocol.handle(ASSET_SCHEME, (request) => {
    const url = new URL(request.url);
    // kioskasset://load/<encoded-abs-path>  -> decode the path after the host.
    const encoded = url.pathname.replace(/^\/+/, "");
    const absPath = normalize(decodeURIComponent(encoded));
    return net.fetch(pathToFileURL(absPath).toString());
  });

  // app:// scheme serves bundled resources (audio-icon.png, placeholder.png, etc.)
  protocol.handle(BUNDLED_SCHEME, (request) => {
    const url = new URL(request.url);
    const filename = url.pathname.replace(/^\/+/, ""); // e.g., "placeholder.png"

    // In production: process.resourcesPath/filename
    // In dev: __dirname/../resources/filename
    const basePath = app.isPackaged
      ? join(process.resourcesPath, filename)
      : join(__dirname, "../../resources", filename);

    const absPath = normalize(basePath);

    // Security: ensure path stays within resources folder
    const resourcesDir = app.isPackaged ? process.resourcesPath : normalize(join(__dirname, "../../resources"));
    if (!absPath.startsWith(resourcesDir)) {
      return new Response("Forbidden", { status: 403 });
    }

    return net.fetch(pathToFileURL(absPath).toString());
  });

  ipcMain.handle("project:load", loadProject);
  ipcMain.handle("project:pick", pickProject);
  ipcMain.handle("project:save", saveProject);
  ipcMain.handle("project:ensureWorkspace", ensureWorkspace);
  ipcMain.handle("assets:save", saveAsset);
  ipcMain.handle("assets:pick", pickImage);
  ipcMain.handle("content:pick", pickContent);
  ipcMain.handle("content:copyExternal", copyExternalFile);
  ipcMain.handle("pptx:import", importPptx);
  ipcMain.handle("data:start", startData);
  ipcMain.handle("data:stop", stopData);
  ipcMain.handle("display:size", () => {
    const { width, height } = screen.getPrimaryDisplay().size;
    return { width, height };
  });
  ipcMain.handle("kiosk:info", () => ({ kiosk: IS_KIOSK, projectPath: KIOSK_PROJECT }));
  ipcMain.handle("window:fullscreen", (e, on: boolean) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w) return;
    if (on) {
      // True borderless fullscreen over the taskbar, no menu/title chrome.
      w.setMenuBarVisibility(false);
      w.setKiosk(true);
    } else {
      w.setKiosk(false);
      w.setMenuBarVisibility(true);
    }
  });
  ipcMain.handle("kiosk:exit", (e) => {
    // In a launched kiosk, leave fullscreen / quit. For the in-app preview the
    // renderer handles exit itself; this is the deployed-kiosk escape.
    if (IS_KIOSK) {
      app.quit();
    } else {
      BrowserWindow.fromWebContents(e.sender)?.setFullScreen(false);
    }
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
