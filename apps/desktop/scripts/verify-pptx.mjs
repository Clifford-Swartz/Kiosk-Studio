// Verify PowerPoint import fidelity against the real deck: parse it standalone,
// feed it through the renderer's buildProjectFromDeck via the test hook, enter
// Play, and screenshot each slide so we can eyeball formatting (mixed bold,
// fit-to-box, no overflow). Run after `electron-vite build`.
import { _electron as electron } from "playwright";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve, join } from "node:path";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";

const here0 = dirname(fileURLToPath(import.meta.url));
const repoRoot0 = resolve(here0, "..", "..", "..");
const { build } = await import(
  pathToFileURL(join(repoRoot0, "node_modules/.pnpm/esbuild@0.21.5/node_modules/esbuild/lib/main.js")).href
);

delete process.env.ELECTRON_RUN_AS_NODE;

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "..");
const repoRoot = resolve(appRoot, "..", "..");
const DECK = "C:/Users/c81210/Downloads/TS1800 Data Center Demo Definition - Sharable .pptx";

// 1. Parse the deck standalone (bundle the TS parser).
await build({
  entryPoints: [join(repoRoot, "packages/pptx/src/index.ts")],
  bundle: true, format: "esm", platform: "node",
  outfile: join(tmpdir(), "pptx-verify-bundle.mjs"), logLevel: "error",
});
const { parsePptx, toWireDeck } = await import(pathToFileURL(join(tmpdir(), "pptx-verify-bundle.mjs")).href);
const parsed = parsePptx(new Uint8Array(readFileSync(DECK)));

// Same wire shape (images as base64) the main-process pptx:import handler
// produces — reuse it rather than re-deriving the mapping here.
const deck = toWireDeck(parsed);

// 2. Launch the built app with an isolated profile.
const app = await electron.launch({
  args: [appRoot, `--user-data-dir=${join(tmpdir(), "kiosk-pptx-verify-profile")}`],
  cwd: appRoot,
});
app.process().stderr?.on("data", (d) => process.stderr.write(`[main:err] ${d}`));
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded");
await page.waitForFunction(() => /add element/i.test(document.body.innerText), { timeout: 15000 });

// 3. Build + load the deck via the test hook.
const ok = await page.evaluate((d) => window.__kioskBuildDeck(d), deck);
console.log("BUILD_DECK_OK:", ok);
await page.waitForTimeout(500);

// 4. Screenshot each scene by switching the active scene in the editor (same
// ElementRenderer + fit logic as Play), so we sidestep the letterboxed
// tap-zone hit-testing in Play.
const sceneIds = await page.evaluate(() => window.__kioskState().project.scenes.map((s) => s.id));
for (let i = 0; i < sceneIds.length; i++) {
  await page.evaluate((id) => window.__kioskState().setActiveScene(id), sceneIds[i]);
  await page.waitForTimeout(250);
  await page.screenshot({ path: resolve(appRoot, `scripts/pptx-slide-${i + 1}.png`) });
}
console.log("SCREENSHOTS_DONE:", sceneIds.length);

await app.close();
