import { app, BrowserWindow, ipcMain, dialog, protocol, net, webContents, screen, Menu } from "electron";
import { getConnectorFactory, type Connector, type ConnectorValue, type SourceSpec } from "@kiosk/connectors";
import { parsePptx } from "@kiosk/pptx";
import { appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir, appendFile, readdir } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, normalize, resolve, sep } from "node:path";
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
 * Get app root directory. Packaged: dirname(process.execPath). Dev: repo root.
 */
function getAppRoot(): string {
  return app.isPackaged
    ? dirname(process.execPath)
    : resolve(__dirname, "..", "..", "..", "..");
}

/**
 * Get shared user-content folder path at app root.
 */
function getSharedUserContentPath(): string {
  return join(getAppRoot(), "user-content");
}

/**
 * Get Exports folder where projects are stored.
 */
function getExportsPath(): string {
  return join(getAppRoot(), "Exports");
}

/**
 * Read project.json and extract exported flag.
 * Returns false if file not found or parsing fails.
 */
async function isProjectExported(projectDir: string): Promise<boolean> {
  try {
    const projectJsonPath = join(projectDir, "project.json");
    const text = await readFile(projectJsonPath, "utf8");
    const parsed = JSON.parse(text);
    return parsed.exported === true;
  } catch {
    return false;
  }
}

/**
 * Rewrite asset paths for export: "user-content/file" → "assets/file"
 */
function rewritePathsForExport(projectObj: Record<string, unknown>): void {
  const scenes = projectObj.scenes as Array<{ background?: unknown; elements: unknown[] }> | undefined;
  if (!scenes) return;

  const rewritePath = (path: unknown): unknown => {
    if (typeof path !== "string") return path;
    if (path.startsWith("user-content/")) {
      return path.replace(/^user-content\//, "assets/");
    }
    return path;
  };

  const processElement = (el: Record<string, unknown>): void => {
    if (el.props && typeof el.props === "object") {
      const props = el.props as Record<string, unknown>;
      if (props.src) props.src = rewritePath(props.src);
      if (props.background) props.background = rewritePath(props.background);
    }
    if (el.children && Array.isArray(el.children)) {
      el.children.forEach(processElement);
    }
  };

  for (const scene of scenes) {
    // Rewrite scene background
    if (scene.background) {
      scene.background = rewritePath(scene.background);
    }
    // Rewrite element paths
    if (scene.elements) {
      scene.elements.forEach((el) => processElement(el as Record<string, unknown>));
    }
  }
}

/**
 * Collect all user-content file references from project.
 * Returns array of filenames (not full paths).
 */
function collectUserContentRefs(projectObj: Record<string, unknown>): string[] {
  const refs = new Set<string>();
  const scenes = projectObj.scenes as Array<{ background?: unknown; elements: unknown[] }> | undefined;
  if (!scenes) return [];

  const extractPath = (path: unknown): void => {
    if (typeof path === "string" && path.startsWith("user-content/")) {
      refs.add(basename(path));
    }
  };

  const processElement = (el: Record<string, unknown>): void => {
    if (el.props && typeof el.props === "object") {
      const props = el.props as Record<string, unknown>;
      if (props.src) extractPath(props.src);
      if (props.background) extractPath(props.background);
    }
    if (el.children && Array.isArray(el.children)) {
      el.children.forEach(processElement);
    }
  };

  for (const scene of scenes) {
    // Extract scene background
    if (scene.background) {
      extractPath(scene.background);
    }
    // Extract element paths
    if (scene.elements) {
      scene.elements.forEach((el) => processElement(el as Record<string, unknown>));
    }
  }

  return Array.from(refs);
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
  await ensureUserContentFolder().catch(() => {
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
 * have a home — no dialog. Creates Exports/<name>-<rand>.kproj/ with the
 * project.json inside, and returns that path. Used the first time an asset is
 * added; the user can later Save As to relocate.
 */
async function ensureWorkspace(
  _e: unknown,
  text: string,
  projectName: string
): Promise<string> {
  const base = getExportsPath();
  const folder = `${safeFolderName(projectName)}-${randomBytes(3).toString("hex")}.kproj`;
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
    const exportsDir = getExportsPath();
    await mkdir(exportsDir, { recursive: true });

    const result = await dialog.showSaveDialog({
      title: "Save Kiosk project",
      defaultPath: join(exportsDir, "project.json"),
      filters: [{ name: "Kiosk project", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return null;
    path = result.filePath;
  }
  await writeFile(path, text, "utf8");
  return path;
}

/** Ensure shared user-content folder exists. */
async function ensureUserContentFolder(): Promise<string> {
  const dir = getSharedUserContentPath();
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Check if file is inside shared user-content folder. */
function isFileInUserContentFolder(filePath: string): boolean {
  const resolved = resolve(filePath);
  const contentDir = resolve(getSharedUserContentPath());
  return resolved.startsWith(contentDir + sep);
}

/**
 * Copy file to shared user-content folder with deduplication (append _1, _2, etc.).
 * Returns relative path: "user-content/filename.ext"
 */
async function copyToUserContent(sourcePath: string): Promise<string> {
  const contentDir = getSharedUserContentPath();
  await mkdir(contentDir, { recursive: true });

  const fileName = basename(sourcePath);
  let targetPath = join(contentDir, fileName);
  let finalName = fileName;

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
  return /^\.(png|jpe?g|gif|webp|svg|bmp|avif|mp4|webm|mov|ogg)$/.test(ext) ? ext : ".png";
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
 * Show content picker dialog defaulting to shared user-content/.
 * Returns chosen file's name and relative path, or null if canceled.
 * Copies external files into shared user-content/ first.
 */
async function pickContent(
  _e: unknown,
  type: "image" | "video" | "audio"
): Promise<{ name: string; path: string } | null> {
  const filterMap: Record<string, string[]> = {
    image: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"],
    video: ["mp4", "webm"],
    audio: ["mp3", "wav", "ogg"],
  };

  const contentDir = getSharedUserContentPath();
  const result = await dialog.showOpenDialog({
    title: `Choose ${type}`,
    defaultPath: contentDir,
    properties: ["openFile"],
    filters: [{ name: type.charAt(0).toUpperCase() + type.slice(1), extensions: filterMap[type]! }],
  });

  if (result.canceled || result.filePaths.length === 0) return null;

  const filePath = result.filePaths[0]!;
  const fileName = basename(filePath);

  if (isFileInUserContentFolder(filePath)) {
    return { name: fileName, path: `user-content/${fileName}` };
  }

  const relativePath = await copyToUserContent(filePath);
  return { name: fileName, path: relativePath };
}

/**
 * Copy an external file to the user-content folder, preserving its original filename.
 * Returns the relative path (e.g., "user-content/image.jpg").
 */
async function copyExternalFile(
  _e: unknown,
  externalFilePath: string
): Promise<string> {
  if (isFileInUserContentFolder(externalFilePath)) {
    return `user-content/${basename(externalFilePath)}`;
  }
  return copyToUserContent(externalFilePath);
}

/**
 * Show an image open dialog; read the chosen file and return its name + base64
 * contents so the renderer can hand it back to saveAsset. Null if canceled.
 */
async function pickImage(): Promise<{ name: string; base64: string } | null> {
  const result = await dialog.showOpenDialog({
    title: "Choose media (image or video)",
    properties: ["openFile"],
    filters: [
      { name: "Images & Videos", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "mp4", "webm", "mov", "ogg"] },
      { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"] },
      { name: "Videos", extensions: ["mp4", "webm", "mov", "ogg"] },
    ],
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

/**
 * Export project: create {name}-exported.kproj/ with bundled assets.
 * Returns exported project path, or null if canceled.
 */
async function exportProject(
  _e: unknown,
  projectPath: string,
  projectText: string
): Promise<string | null> {
  try {
    const projectDir = dirname(projectPath);
    const projectObj = JSON.parse(projectText);
    const projectName = projectObj.name || "Untitled";

    // Generate export folder name
    const safeName = safeFolderName(projectName);
    let exportFolderName = `${safeName}-exported.kproj`;
    let exportDir = join(projectDir, "..", exportFolderName);

    // Check if export exists
    if (await fileExists(join(exportDir, "project.json"))) {
      const result = await dialog.showMessageBox({
        type: "question",
        title: "Export Exists",
        message: `Export "${exportFolderName}" already exists.`,
        buttons: ["Overwrite", "Rename", "Cancel"],
        defaultId: 1,
        cancelId: 2,
      });

      if (result.response === 2) return null;

      if (result.response === 1) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        exportFolderName = `${safeName}-exported-${timestamp}.kproj`;
        exportDir = join(projectDir, "..", exportFolderName);
      }
    }

    // Create export directory
    await mkdir(exportDir, { recursive: true });
    const exportAssetsDir = join(exportDir, "assets");
    await mkdir(exportAssetsDir, { recursive: true });

    // Copy placeholders from project assets/
    const projectAssetsDir = join(projectDir, "assets");
    if (await fileExists(projectAssetsDir)) {
      const placeholderFiles = await readdir(projectAssetsDir);
      for (const file of placeholderFiles) {
        const buf = await readFile(join(projectAssetsDir, file));
        await writeFile(join(exportAssetsDir, file), buf);
      }
    }

    // Collect user-content references
    const userContentRefs = collectUserContentRefs(projectObj);
    const sharedUserContent = getSharedUserContentPath();

    // Copy user-content files to export assets/ with deduplication
    const copiedFiles = new Map<string, string>();
    for (const filename of userContentRefs) {
      const srcPath = join(sharedUserContent, filename);
      if (!(await fileExists(srcPath))) {
        console.warn(`[export] user-content file not found: ${filename}`);
        continue;
      }

      let destFilename = filename;
      let destPath = join(exportAssetsDir, destFilename);

      // Deduplicate if collision
      if (await fileExists(destPath)) {
        const ext = extname(filename);
        const base = filename.slice(0, -ext.length);
        let i = 1;
        while (await fileExists(join(exportAssetsDir, `${base}_${i}${ext}`))) {
          i++;
        }
        destFilename = `${base}_${i}${ext}`;
        destPath = join(exportAssetsDir, destFilename);
      }

      const buf = await readFile(srcPath);
      await writeFile(destPath, buf);
      copiedFiles.set(filename, destFilename);
    }

    // Rewrite paths
    rewritePathsForExport(projectObj);
    projectObj.exported = true;

    // Handle deduplication remapping
    for (const [original, renamed] of copiedFiles.entries()) {
      if (original !== renamed) {
        const scenes = projectObj.scenes as Array<{ background?: unknown; elements: unknown[] }>;
        const replaceInElement = (el: Record<string, unknown>): void => {
          if (el.props && typeof el.props === "object") {
            const props = el.props as Record<string, unknown>;
            if (props.src === `assets/${original}`) props.src = `assets/${renamed}`;
            if (props.background === `assets/${original}`) props.background = `assets/${renamed}`;
          }
          if (el.children && Array.isArray(el.children)) {
            el.children.forEach(replaceInElement);
          }
        };
        for (const scene of scenes) {
          // Replace scene background
          if (scene.background === `assets/${original}`) {
            scene.background = `assets/${renamed}`;
          }
          // Replace element paths
          if (scene.elements) {
            scene.elements.forEach((el) => replaceInElement(el as Record<string, unknown>));
          }
        }
      }
    }

    // Write exported project.json
    const exportProjectPath = join(exportDir, "project.json");
    await writeFile(exportProjectPath, JSON.stringify(projectObj, null, 2), "utf8");

    // Show success message
    await dialog.showMessageBox({
      type: "info",
      title: "Export Complete",
      message: `Project exported successfully!`,
      detail: `Location: ${exportDir}\n\nThe exported project is ready to share or deploy.`,
      buttons: ["Open Folder", "OK"],
      defaultId: 0,
    }).then((result) => {
      if (result.response === 0) {
        import("node:child_process").then((cp) => {
          if (process.platform === "win32") {
            cp.exec(`explorer "${exportDir}"`);
          } else if (process.platform === "darwin") {
            cp.exec(`open "${exportDir}"`);
          } else {
            cp.exec(`xdg-open "${exportDir}"`);
          }
        });
      }
    });

    return exportProjectPath;
  } catch (err) {
    console.error("[export] Failed:", err);
    await dialog.showMessageBox({
      type: "error",
      title: "Export Failed",
      message: `Export failed: ${err instanceof Error ? err.message : String(err)}`,
      buttons: ["OK"],
    });
    return null;
  }
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
    if (wc && !wc.isDestroyed()) {
      // Check if value contains an error (connectors emit { __error: message })
      const isError = v.value != null && typeof v.value === "object" && "__error" in v.value;

      if (isError) {
        // Emit dataError event
        wc.send("event:emit", {
          kind: "dataError",
          payload: { sourceId: v.sourceId, error: (v.value as { __error: string }).__error },
          timestamp: v.at
        });
      } else {
        // Emit dataChanged event
        wc.send("event:emit", {
          kind: "dataChanged",
          payload: { sourceId: v.sourceId, value: v.value },
          timestamp: v.at
        });
      }
    }
  };
  for (const spec of sources) {
    const factory = getConnectorFactory(spec.kind);
    if (!factory) continue;
    const conn = factory(spec, emit);
    activeConnectors.push(conn);
    try {
      await conn.start();
    } catch (err) {
      // Emit dataError event for startup failures
      const wc = liveWebContentsId != null ? webContents.fromId(liveWebContentsId) : null;
      if (wc && !wc.isDestroyed()) {
        wc.send("event:emit", {
          kind: "dataError",
          payload: {
            sourceId: spec.id,
            error: err instanceof Error ? err.message : String(err)
          },
          timestamp: Date.now()
        });
      }
    }
  }
}

app.whenReady().then(async () => {
  // No default application menu — the editor has its own TopBar and a kiosk
  // must show no chrome. This removes the File/Edit/View/Window/Help bar.
  Menu.setApplicationMenu(null);

  // Ensure Exports/ and shared user-content/ exist
  await mkdir(getExportsPath(), { recursive: true });
  await mkdir(getSharedUserContentPath(), { recursive: true });

  // Serve project assets via the privileged scheme. Resolves paths based on
  // exported flag for working vs bundled projects.
  protocol.handle(ASSET_SCHEME, async (request) => {
    const url = new URL(request.url);
    // kioskasset://load/<encoded-project-dir>/<relative-path>
    const fullPath = url.pathname.replace(/^\/+/, "");
    const decoded = decodeURIComponent(fullPath);

    console.log(`[${ASSET_SCHEME}] Request: ${request.url}`);
    console.log(`[${ASSET_SCHEME}] Decoded: ${decoded}`);

    // Parse project directory and relative path
    // Look for .kproj/ boundary
    const kprojMatch = decoded.match(/^(.+\.kproj)[/\\](.+)$/);

    let absPath: string;

    if (!kprojMatch) {
      // Fallback: no .kproj boundary found
      // Check if path contains user-content/ or assets/ segment
      const userContentIndex = decoded.indexOf("user-content/");
      const assetsIndex = decoded.indexOf("assets/");

      if (userContentIndex >= 0) {
        // Extract relative path from user-content/ onwards
        const relativePath = decoded.slice(userContentIndex);
        absPath = normalize(join(getAppRoot(), relativePath));
        console.log(`[${ASSET_SCHEME}] Fallback user-content: ${relativePath} → ${absPath}`);
      } else if (assetsIndex >= 0) {
        // Extract relative path from assets/ onwards
        const relativePath = decoded.slice(assetsIndex);
        absPath = normalize(join(getAppRoot(), relativePath));
        console.log(`[${ASSET_SCHEME}] Fallback assets: ${relativePath} → ${absPath}`);
      } else {
        // No known prefix → treat as absolute path
        absPath = normalize(decoded);
      }
    } else {
      const projectDir = kprojMatch[1];
      const relativePath = kprojMatch[2];

      console.log(`[${ASSET_SCHEME}] Project: ${projectDir}`);
      console.log(`[${ASSET_SCHEME}] Relative: ${relativePath}`);

      const exported = await isProjectExported(projectDir);
      console.log(`[${ASSET_SCHEME}] Exported: ${exported}`);

      // Resolve based on exported flag and path prefix
      if (relativePath.startsWith("user-content/")) {
        if (exported) {
          // Exported: user-content refs should have been rewritten to assets/
          absPath = normalize(join(projectDir, "assets", basename(relativePath)));
          console.log(`[${ASSET_SCHEME}] Warning: Exported project referencing user-content/`);
        } else {
          // Working: resolve user-content/ from app root
          absPath = normalize(join(getAppRoot(), relativePath));
        }
      } else if (relativePath.startsWith("assets/")) {
        // Both: assets/ resolves from project dir
        absPath = normalize(join(projectDir, relativePath));
      } else {
        // No prefix: absolute path fallback
        absPath = normalize(decoded);
      }
    }

    const fileUrl = pathToFileURL(absPath).toString();
    console.log(`[${ASSET_SCHEME}] Resolved: ${absPath}`);

    try {
      const fetchHeaders = new Headers();
      const range = request.headers.get("range");
      if (range) {
        fetchHeaders.set("Range", range);
        console.log(`[${ASSET_SCHEME}] Range: ${range}`);
      }

      const response = await net.fetch(fileUrl, { headers: fetchHeaders });
      console.log(`[${ASSET_SCHEME}] Fetch: ${response.status}`);

      // Ensure correct MIME type
      const ext = extname(absPath).toLowerCase();
      const mimeMap: Record<string, string> = {
        ".mp4": "video/mp4", ".webm": "video/webm",
        ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg",
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
      };
      const contentType = mimeMap[ext] || response.headers.get("content-type") || "application/octet-stream";

      const headers = new Headers();
      headers.set("Content-Type", contentType);
      headers.set("Accept-Ranges", "bytes");

      const contentLength = response.headers.get("content-length");
      if (contentLength) headers.set("Content-Length", contentLength);

      const contentRange = response.headers.get("content-range");
      if (contentRange) headers.set("Content-Range", contentRange);

      return new Response(response.body, { status: response.status, headers });
    } catch (err) {
      console.error(`[${ASSET_SCHEME}] Failed to load ${absPath}:`, err);
      return new Response("Not Found", { status: 404 });
    }
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
  ipcMain.handle("project:export", exportProject);
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
  ipcMain.handle("app:root", () => getAppRoot());
  ipcMain.handle("kiosk:info", () => ({ kiosk: IS_KIOSK, projectPath: KIOSK_PROJECT }));
  ipcMain.handle("analytics:write", async (_e, path: string, data: string, appendMode: boolean) => {
    try {
      // Resolve to absolute path (relative paths are resolved against userData)
      const absPath = isAbsolute(path) ? normalize(path) : join(app.getPath("userData"), path);

      // Security: Validate path is within safe boundaries (userData or temp)
      const userDataDir = app.getPath("userData");
      const tempDir = app.getPath("temp");
      const isInUserData = absPath.startsWith(userDataDir);
      const isInTemp = absPath.startsWith(tempDir);

      if (!isInUserData && !isInTemp) {
        return {
          success: false,
          error: `Path outside allowed directories. Must be in ${userDataDir} or ${tempDir}`
        };
      }

      // Ensure parent directory exists
      await mkdir(dirname(absPath), { recursive: true });

      // Write or append
      if (appendMode) {
        await appendFile(absPath, data + "\n", "utf-8");
      } else {
        await writeFile(absPath, data, "utf-8");
      }

      return { success: true };
    } catch (err) {
      console.error("[IPC] analytics:write failed:", err);
      return { success: false, error: String(err) };
    }
  });
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
