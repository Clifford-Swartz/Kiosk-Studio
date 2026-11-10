import { app, BrowserWindow, ipcMain, net, shell } from "electron";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, writeFileSync } from "node:fs";
import { mkdir, readdir, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * Self-updater for the portable Windows build.
 *
 * Kiosk Studio ships as a zipped app folder on GitHub Releases (see
 * scripts/pack.mjs) - there is no installer, so Electron's Squirrel-based
 * autoUpdater doesn't apply. Instead:
 *
 *   1. check    - ask the GitHub API for the latest release, compare its tag
 *                 against app.getVersion() (apps/desktop/package.json version).
 *   2. download - fetch the win32-x64 zip, verify its sha256 against the digest
 *                 GitHub publishes, extract it into userData/updates/.
 *   3. install  - a running exe can't overwrite itself, so a detached .cmd
 *                 waits for this process to exit, robocopies the new files
 *                 over the app folder, and (optionally) relaunches.
 *
 * Exports/, user-content/ and analytics/ live next to the exe and are the
 * user's own work; the install step never touches them.
 */

const REPO = "Clifford-Swartz/Kiosk-Studio";
const LATEST_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases`;
const DOWNLOAD_PREFIX = `https://github.com/${REPO}/releases/download/`;
const ASSET_PATTERN = /win32-x64.*\.zip$/i;
/** Kiosks stay up for days, so re-check while running, not just at launch. */
const RECHECK_MS = 6 * 60 * 60 * 1000;
/** Folders beside the exe that hold the user's work - never overwritten. */
const USER_DIRS = ["Exports", "user-content", "analytics"];

export interface UpdateStatus {
  state: "idle" | "checking" | "up-to-date" | "available" | "downloading" | "ready" | "error";
  currentVersion: string;
  latestVersion: string | null;
  /** Download progress 0-100 while state is "downloading". */
  percent: number | null;
  error: string | null;
  autoUpdate: boolean;
  /** False in dev and on non-Windows builds: can check, but not self-install. */
  canInstall: boolean;
}

interface SettingsAccess {
  get(key: "autoUpdate"): boolean | undefined;
  set(key: "autoUpdate", value: boolean): void;
}

interface ReleaseAsset {
  url: string;
  size: number;
  sha256: string | null;
}

let settings: SettingsAccess;
let state: UpdateStatus["state"] = "idle";
let latestVersion: string | null = null;
let latestAsset: ReleaseAsset | null = null;
let releaseUrl = RELEASES_PAGE;
let percent: number | null = null;
let lastError: string | null = null;
/** Extracted app folder waiting to be copied over the install. */
let stagedDir: string | null = null;
let installSpawned = false;

function canInstall(): boolean {
  return app.isPackaged && process.platform === "win32";
}

function snapshot(): UpdateStatus {
  return {
    state,
    currentVersion: app.getVersion(),
    latestVersion,
    percent,
    error: lastError,
    autoUpdate: settings.get("autoUpdate") ?? false,
    canInstall: canInstall() && (state !== "available" || latestAsset !== null),
  };
}

function broadcast(): void {
  const status = snapshot();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("update:status", status);
  }
}

function setState(next: UpdateStatus["state"], error: string | null = null): void {
  state = next;
  lastError = error;
  if (next !== "downloading") percent = null;
  broadcast();
}

/** "v0.10.2" -> [0, 10, 2]. Non-numeric parts count as 0. */
function parseVersion(v: string): number[] {
  return v
    .replace(/^v/i, "")
    .split(/[.+-]/)
    .slice(0, 3)
    .map((p) => parseInt(p, 10) || 0);
}

function isNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  for (let i = 0; i < 3; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

function updatesDir(): string {
  return join(app.getPath("userData"), "updates");
}

/**
 * Deleting a few hundred MB of freshly extracted exes/dlls on Windows often
 * trips ENOTEMPTY/EBUSY while antivirus still holds handles; retry through it.
 */
function removeDir(dir: string): Promise<void> {
  return rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}

async function check(): Promise<UpdateStatus> {
  // A download in flight or already staged wins; don't reset it by re-checking.
  if (state === "checking" || state === "downloading" || state === "ready") return snapshot();
  setState("checking");
  try {
    const res = await net.fetch(LATEST_URL, { headers: { Accept: "application/vnd.github+json" } });
    if (res.status === 404) {
      // Repo has no published release yet.
      setState("up-to-date");
      return snapshot();
    }
    if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
    const release = (await res.json()) as {
      tag_name?: string;
      html_url?: string;
      assets?: { name?: string; size?: number; digest?: string | null; browser_download_url?: string }[];
    };
    const tag = release.tag_name ?? "";
    if (!tag || !isNewer(tag, app.getVersion())) {
      latestVersion = tag ? tag.replace(/^v/i, "") : null;
      setState("up-to-date");
      return snapshot();
    }

    latestVersion = tag.replace(/^v/i, "");
    if (release.html_url?.startsWith(`https://github.com/${REPO}/`)) releaseUrl = release.html_url;
    const asset = release.assets?.find(
      (a) => ASSET_PATTERN.test(a.name ?? "") && (a.browser_download_url ?? "").startsWith(DOWNLOAD_PREFIX)
    );
    latestAsset = asset
      ? {
          url: asset.browser_download_url as string,
          size: asset.size ?? 0,
          sha256: asset.digest?.startsWith("sha256:") ? asset.digest.slice(7).toLowerCase() : null,
        }
      : null;
    setState("available");

    if (settings.get("autoUpdate") && canInstall() && latestAsset) void download();
  } catch (err) {
    setState("error", `Update check failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return snapshot();
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`${basename(cmd)} exited with code ${code}`))
    );
  });
}

/**
 * The zip may hold the app at its root or inside one wrapper folder
 * ("Kiosk Studio-win32-x64/"); find whichever level has the exe.
 */
async function findPayloadRoot(extractDir: string): Promise<string | null> {
  const exeName = basename(process.execPath);
  if (existsSync(join(extractDir, exeName))) return extractDir;
  for (const entry of await readdir(extractDir, { withFileTypes: true })) {
    if (entry.isDirectory() && existsSync(join(extractDir, entry.name, exeName))) {
      return join(extractDir, entry.name);
    }
  }
  return null;
}

async function download(): Promise<void> {
  if (state !== "available" || !latestAsset || !latestVersion) return;
  if (!canInstall()) return;
  const asset = latestAsset;
  state = "downloading";
  percent = 0;
  lastError = null;
  broadcast();

  const root = updatesDir();
  try {
    await removeDir(root);
    const extractDir = join(root, latestVersion);
    await mkdir(extractDir, { recursive: true });
    const zipPath = join(root, "update.zip");

    const res = await net.fetch(asset.url);
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
    const total = asset.size || Number(res.headers.get("content-length")) || 0;
    const hash = createHash("sha256");
    let received = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        hash.update(chunk);
        received += chunk.length;
        const next = total > 0 ? Math.min(100, Math.floor((received / total) * 100)) : 0;
        if (next !== percent) {
          percent = next;
          broadcast();
        }
        cb(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(res.body as unknown as Parameters<typeof Readable.fromWeb>[0]),
      meter,
      createWriteStream(zipPath)
    );

    if (asset.sha256 && hash.digest("hex") !== asset.sha256) {
      throw new Error("Downloaded file failed its integrity check");
    }

    // Windows' own bsdtar reads zips and is far faster than Expand-Archive.
    // Absolute path: a different tar earlier on PATH may not handle zip.
    const tar = join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "tar.exe");
    await run(tar, ["-xf", zipPath, "-C", extractDir]);
    await rm(zipPath, { force: true });

    const payload = await findPayloadRoot(extractDir);
    if (!payload) throw new Error("Update package did not contain the app");
    stagedDir = payload;
    setState("ready");
  } catch (err) {
    stagedDir = null;
    await removeDir(root).catch(() => undefined);
    setState("error", `Update download failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Quote a path for a .cmd file: escape %, and keep a trailing "\" from eating the closing quote. */
function cmdPath(p: string): string {
  const escaped = p.replace(/%/g, "%%");
  return escaped.endsWith("\\") ? `${escaped}.` : escaped;
}

/**
 * Hand the staged files to a detached script that outlives this process.
 * Returns false if there is nothing staged or the script couldn't be started.
 */
function spawnInstaller(relaunch: boolean): boolean {
  if (installSpawned || !stagedDir || !canInstall()) return false;
  try {
    const appDir = dirname(process.execPath);
    const exe = join(appDir, basename(process.execPath));
    const log = join(app.getPath("userData"), "update.log");
    const pid = process.pid;
    const excludes = USER_DIRS.map((d) => `"%SRC%\\${d}"`).join(" ");
    const quiet = "/NFL /NDL /NP /R:20 /W:1";
    // No parenthesised blocks: a path containing ")" would end the block early.
    const script = [
      "@echo off",
      "chcp 65001 >NUL",
      "setlocal",
      `set "SRC=${cmdPath(stagedDir)}"`,
      `set "DST=${cmdPath(appDir)}"`,
      `set "LOG=${cmdPath(log)}"`,
      ":wait",
      `tasklist /FI "PID eq ${pid}" /NH 2>NUL | find " ${pid} " >NUL`,
      "if errorlevel 1 goto copy",
      "ping -n 2 127.0.0.1 >NUL",
      "goto wait",
      ":copy",
      `echo [%DATE% %TIME%] Installing update from "%SRC%" > "%LOG%"`,
      // /E without /PURGE: adds and overwrites, never deletes the user's folders.
      `robocopy "%SRC%" "%DST%" /E /XD ${excludes} ${quiet} >> "%LOG%" 2>&1`,
      "if errorlevel 8 goto failed",
      `if not exist "%SRC%\\resources\\app\\" goto done`,
      // The bundled app code uses hashed filenames; mirror it so old builds don't pile up.
      `robocopy "%SRC%\\resources\\app" "%DST%\\resources\\app" /MIR ${quiet} >> "%LOG%" 2>&1`,
      "if errorlevel 8 goto failed",
      ":done",
      `echo [%DATE% %TIME%] Update installed >> "%LOG%"`,
      "goto finish",
      ":failed",
      `echo [%DATE% %TIME%] Update FAILED (robocopy error) >> "%LOG%"`,
      ":finish",
      `rmdir /s /q "${cmdPath(updatesDir())}"`,
      relaunch ? `start "" "${cmdPath(exe)}"` : "",
      "exit /b",
      "",
    ].join("\r\n");

    const scriptPath = join(app.getPath("temp"), `kiosk-studio-update-${pid}.cmd`);
    writeFileSync(scriptPath, script, "utf8");
    const child = spawn(process.env["ComSpec"] ?? "cmd.exe", ["/d", "/s", "/c", `""${scriptPath}""`], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      windowsVerbatimArguments: true,
    });
    child.unref();
    installSpawned = true;
    return true;
  } catch (err) {
    setState("error", `Could not start the installer: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

function installNow(): void {
  if (state !== "ready") return;
  if (spawnInstaller(true)) app.quit();
}

function setAutoUpdate(on: boolean): UpdateStatus {
  settings.set("autoUpdate", on);
  broadcast();
  if (on && state === "available") void download();
  return snapshot();
}

export function initUpdater(store: SettingsAccess): void {
  settings = store;

  ipcMain.handle("update:status", () => snapshot());
  ipcMain.handle("update:check", () => check());
  ipcMain.handle("update:download", () => {
    void download();
  });
  ipcMain.handle("update:install", () => installNow());
  ipcMain.handle("update:setAuto", (_e, on: boolean) => setAutoUpdate(on === true));
  ipcMain.handle("update:openRelease", () => shell.openExternal(releaseUrl));

  // A downloaded update installs as the app closes, so a kiosk left running
  // picks it up on its next restart without anyone clicking anything.
  app.on("will-quit", () => {
    if (state === "ready") spawnInstaller(false);
  });

  // Leftovers from a download that was interrupted by a crash or power cut.
  void removeDir(updatesDir())
    .catch(() => undefined)
    .then(() => check());
  setInterval(() => void check(), RECHECK_MS).unref();
}
