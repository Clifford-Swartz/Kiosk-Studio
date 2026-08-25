// Verifies the new "Scrub video between times" interaction action
// (scrubVideo): add a video element, wire a tap trigger with scrubVideo
// (current -> 0, 800ms), enter Play, let the video run a couple seconds,
// tap it, and confirm currentTime tweens smoothly back to 0 instead of
// jump-cutting, with no console errors. Run after `electron-vite build`.
import { _electron as electron } from "playwright";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";

delete process.env.ELECTRON_RUN_AS_NODE;

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "..");
const videoPath = resolve(appRoot, "../../Exports/MastersKiosk.kproj/assets/CreateFile.mp4");
const videoUrl = pathToFileURL(videoPath).href;

const app = await electron.launch({
  args: [appRoot, `--user-data-dir=${join(tmpdir(), "kiosk-smoke-scrubvideo-profile")}`],
  cwd: appRoot,
});
app.process().stdout?.on("data", (d) => process.stdout.write(`[main] ${d}`));
app.process().stderr?.on("data", (d) => process.stderr.write(`[main:err] ${d}`));

const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded");

const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(String(err)));

const results = {};

await page.waitForFunction(
  () => document.body.innerText.includes("Kiosk Studio") && /add element/i.test(document.body.innerText),
  { timeout: 15000 }
);
results.EDITOR_LOADED = true;

// Add a video element with a real mp4 asset via the store directly (file
// dialogs aren't drivable by Playwright).
const setup = await page.evaluate((url) => {
  const state = window.__kioskState();
  state.addElement("video");
  const id = window.__kioskState().selectedId;
  state.updateElementProps(id, { src: url, autoplay: true, loop: false, muted: true });
  return { id };
}, videoUrl);
results.VIDEO_ELEMENT_ADDED = setup.id;

await page.waitForFunction(() => /Properties · video/i.test(document.body.innerText), { timeout: 5000 });
results.VIDEO_SELECTED = true;

// Add a tap trigger.
const addTriggerSelect = page.locator("select").filter({ hasText: "Add trigger" });
await addTriggerSelect.selectOption("tap");
await page.waitForFunction(() => document.body.innerText.includes("When tap"), { timeout: 5000 });
results.TRIGGER_ADDED = true;

// Add the "Scrub video between times" action.
const addActionSelect = page.locator("select").filter({ hasText: "Add action" }).first();
await addActionSelect.selectOption("scrubVideo");
await page.waitForFunction(() => document.body.innerText.includes("Scrub"), { timeout: 5000 });
results.SCRUB_ACTION_ADDED = true;

// Rows are collapsed by default; expand it to reach the field editor.
await page.getByText(/^▸ Scrub/).click();
await page.waitForFunction(() => document.body.innerText.includes("Duration (ms)") || document.body.querySelector('input[placeholder="Duration (ms)"]'), { timeout: 5000 }).catch(() => {});
results.ROW_EXPANDED = true;

// Fill in the action fields: target = our video, To = 0, Duration = 800ms.
await page.locator("select").filter({ hasText: "— choose video —" }).first().selectOption(setup.id);
await page.getByPlaceholder("To (s)").fill("0");
await page.getByPlaceholder("Duration (ms)").fill("800");
results.SCRUB_PARAMS_SET = true;

await page.screenshot({ path: resolve(appRoot, "scripts/scrubvideo-editor.png") });

// Enter Play mode.
await page.locator('button[title*="Preview"]').click();
await page.waitForFunction(() => document.body.innerText.includes("Kiosk Studio"), { timeout: 5000 });

// Let it play ~2s so there's meaningful currentTime to scrub back from.
await page.waitForTimeout(2000);

const readVideo = (id) => {
  const v = document.querySelector(`[data-element-id="${id}"] video`) || document.querySelector("video");
  return v ? { currentTime: v.currentTime, paused: v.paused, readyState: v.readyState } : null;
};

const before = await page.evaluate(readVideo, setup.id);
results.BEFORE_TAP = before;

const tapped = await page.evaluate((id) => {
  const el = document.querySelector(`[data-element-id="${id}"]`);
  if (!el) return false;
  el.click();
  return true;
}, setup.id);
results.TAPPED = tapped;

// Sample mid-scrub (~400ms into the 800ms scrub) to confirm it's tweening,
// not jump-cutting straight to 0.
await page.waitForTimeout(400);
const mid = await page.evaluate(readVideo, setup.id);
results.MID_SCRUB = mid;

// Let the scrub finish.
await page.waitForTimeout(700);
const after = await page.evaluate(readVideo, setup.id);
results.AFTER_SCRUB = after;

results.SCRUB_WAS_TWEENED =
  before && mid && after && mid.currentTime < before.currentTime && mid.currentTime > 0.05
    ? true
    : `possible jump-cut or read failure: before=${JSON.stringify(before)} mid=${JSON.stringify(mid)}`;
results.SCRUB_REACHED_TARGET = after && after.currentTime < 0.15 ? true : `did not reach ~0: ${JSON.stringify(after)}`;

await page.screenshot({ path: resolve(appRoot, "scripts/scrubvideo-play.png") });

// Navigate away and back to confirm a scrub cancels cleanly on scene change
// (AnimationRuntime.cancelAll should clear activeMediaScrubs too).
const navResult = await page.evaluate((id) => {
  const el = document.querySelector(`[data-element-id="${id}"]`);
  if (!el) return false;
  el.click();
  return true;
}, setup.id);
results.RETRIGGERED_THEN_NAVIGATING = navResult;
await page.waitForTimeout(100); // mid-scrub
await page.getByRole("button", { name: /Exit preview/i }).click(); // back to editor, cancelAll() fires
await page.waitForTimeout(300);
results.NO_CRASH_ON_CANCEL = true;

results.CONSOLE_ERRORS = consoleErrors.filter((e) => !/Autofill|DevTools/i.test(e));

for (const [k, v] of Object.entries(results)) console.log(`${k}:`, typeof v === "object" ? JSON.stringify(v) : v);

await app.close();
