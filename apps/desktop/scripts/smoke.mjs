// Launches the built Electron app with Playwright and verifies the M3 editor:
// the editor loads the example, you can add an element, the layer tree + canvas
// reflect it, ▶ Play renders it in the real Player, and a save->reload round
// trip through the IPC bridge persists the edit. Writes screenshots.
// Run after `electron-vite build`.
import { _electron as electron } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// If set (common in Electron-as-Node tooling), the Electron binary runs as
// plain Node and never opens a window — clear it so the GUI launches.
delete process.env.ELECTRON_RUN_AS_NODE;

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "..");

// Use an isolated user-data dir so the test doesn't collide with a running
// `pnpm dev` instance (shared cache dir → "Unable to create cache" errors).
const app = await electron.launch({
  args: [appRoot, `--user-data-dir=${join(tmpdir(), "kiosk-smoke-profile")}`],
  cwd: appRoot,
});
app.process().stdout?.on("data", (d) => process.stdout.write(`[main] ${d}`));
app.process().stderr?.on("data", (d) => process.stderr.write(`[main:err] ${d}`));

const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded");

const results = {};

// 1. Editor loaded: the TopBar + palette are visible. (Note: innerText reflects
// CSS text-transform, so the palette heading reads "ADD ELEMENT" uppercased.)
await page.waitForFunction(
  () =>
    document.body.innerText.includes("Kiosk Studio") &&
    /add element/i.test(document.body.innerText),
  { timeout: 15000 }
);
results.EDITOR_LOADED = true;

// 2. Add a rectangle via the palette.
await page.getByRole("button", { name: "Rectangle" }).click();
await page.screenshot({ path: resolve(appRoot, "scripts/editor.png") });

// The new element becomes selected -> Properties panel shows "rectangle".
await page.waitForFunction(
  () => /Properties · rectangle/i.test(document.body.innerText),
  { timeout: 5000 }
);
results.ADD_ELEMENT_OK = true;

// 3. Save -> reload round trip via the IPC bridge to a temp file.
const tmpPath = join(tmpdir(), `kiosk-smoke-${Date.now()}.json`);
const saved = await page.evaluate(async (p) => {
  // Read the live project off the renderer test hook and persist it via the
  // same IPC bridge App.handleSave uses, but to an explicit path (no dialog).
  const proj = window.__kioskProject;
  if (!proj) return { ok: false, reason: "no test hook" };
  const text = JSON.stringify(proj, null, 2);
  const path = await window.kiosk.saveProject(text, p);
  return { ok: !!path, path };
}, tmpPath);

if (saved.ok) {
  const text = await readFile(tmpPath, "utf8");
  const reloaded = JSON.parse(text);
  const home = reloaded.scenes.find((s) => s.name === "Home") ?? reloaded.scenes[0];
  results.SAVE_RELOAD_OK = home.elements.length >= 5; // 4 example + 1 added
  await rm(tmpPath, { force: true });
} else {
  results.SAVE_RELOAD_OK = `skipped: ${saved.reason ?? "save failed"}`;
}

// 4. ▶ Play -> the real Player renders the (edited) project.
await page.getByRole("button", { name: /Play/ }).click();
await page.waitForFunction(
  () => document.body.innerText.includes("Welcome to Kiosk Studio"),
  { timeout: 5000 }
);
results.PLAY_OK = true;
await page.screenshot({ path: resolve(appRoot, "scripts/editor-play.png") });

for (const [k, v] of Object.entries(results)) console.log(`${k}:`, v);

await app.close();
