// Launches the built Electron app and verifies the updater: the main process
// reaches the GitHub releases API and settles on a state, the TopBar popover
// renders it, and the auto-update toggle round-trips through electron-store.
// Needs network access. Run after `electron-vite build`.
import { _electron as electron } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";

delete process.env.ELECTRON_RUN_AS_NODE;

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "..");

const app = await electron.launch({
  args: [appRoot, `--user-data-dir=${join(tmpdir(), "kiosk-smoke-update-profile")}`],
  cwd: appRoot,
});
app.process().stderr?.on("data", (d) => process.stderr.write(`[main:err] ${d}`));

const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded");
await page.waitForFunction(() => document.body.innerText.includes("Kiosk Studio"), { timeout: 15000 });

const results = {};
let failed = false;

try {
  // 1. The startup check settles (not stuck on idle/checking).
  // Polled from here rather than waitForFunction: an async predicate's pending
  // Promise counts as truthy there, so it would return before the check ends.
  let status = null;
  for (const deadline = Date.now() + 30000; Date.now() < deadline; ) {
    status = await page.evaluate(() => window.kiosk.getUpdateStatus());
    if (status.state !== "idle" && status.state !== "checking") break;
    await new Promise((r) => setTimeout(r, 500));
  }
  results.STATUS = status;
  results.CHECK_SETTLED = status.state === "up-to-date" || status.state === "available";
  // Unpackaged build must never offer a self-install.
  results.DEV_CANNOT_INSTALL = status.canInstall === false;

  // 2. Popover renders the version and state.
  await page.locator('button[title*="Updates"], button[title*="available"]').first().click();
  await page.waitForFunction((v) => document.body.innerText.includes(`Kiosk Studio v${v}`), status.currentVersion, {
    timeout: 5000,
  });
  results.POPOVER_OK = true;
  await page.screenshot({ path: resolve(appRoot, "scripts/update-popover.png") });

  // 3. Auto-update toggle persists, then restore it.
  const toggle = page.getByLabel("Update automatically");
  await toggle.check();
  results.AUTO_ON = (await page.evaluate(() => window.kiosk.getUpdateStatus())).autoUpdate === true;
  await toggle.uncheck();
  results.AUTO_OFF = (await page.evaluate(() => window.kiosk.getUpdateStatus())).autoUpdate === false;
} catch (err) {
  failed = true;
  console.error("SMOKE ERROR:", err);
} finally {
  await app.close();
}

console.log(JSON.stringify(results, null, 2));
const ok = !failed && ["CHECK_SETTLED", "DEV_CANNOT_INSTALL", "POPOVER_OK", "AUTO_ON", "AUTO_OFF"].every((k) => results[k] === true);
console.log(ok ? "UPDATE SMOKE PASSED" : "UPDATE SMOKE FAILED");
process.exit(ok ? 0 : 1);
