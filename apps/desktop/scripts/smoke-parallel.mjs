// Verifies the parallel-action-group feature end to end:
// add two animate actions to a tap trigger, drag one onto the other to form
// a "Run together" group, confirm it collapses to a group row, ungroup it
// back, and confirm the app still boots+plays after the round trip.
// Run after `electron-vite build` (pnpm -r build).
import { _electron as electron } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";

delete process.env.ELECTRON_RUN_AS_NODE;

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "..");

const app = await electron.launch({
  args: [appRoot, `--user-data-dir=${join(tmpdir(), "kiosk-smoke-parallel-profile")}`],
  cwd: appRoot,
});
app.process().stdout?.on("data", (d) => process.stdout.write(`[main] ${d}`));
app.process().stderr?.on("data", (d) => process.stderr.write(`[main:err] ${d}`));

const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded");

const results = {};

await page.waitForFunction(
  () => document.body.innerText.includes("Kiosk Studio") && /add element/i.test(document.body.innerText),
  { timeout: 15000 }
);
results.EDITOR_LOADED = true;

// Select the existing "rectangle" layer row (Scene Structure list) so the
// Interactions panel renders for it.
await page.getByText("rectangle", { exact: true }).click();
await page.waitForFunction(() => /Properties · rectangle/i.test(document.body.innerText), { timeout: 5000 });
results.ELEMENT_SELECTED = true;

// Add a tap trigger.
const addTriggerSelect = page.locator("select").filter({ hasText: "Add trigger" });
await addTriggerSelect.selectOption("tap");
await page.waitForFunction(() => document.body.innerText.includes("When tap"), { timeout: 5000 });
results.TRIGGER_ADDED = true;

// Add two "animate" actions via the "+ Add action..." menu under the tap trigger.
const addActionSelect = page.locator("select").filter({ hasText: "Add action" }).first();
await addActionSelect.selectOption("animate");
await addActionSelect.selectOption("animate");
await page.waitForFunction(() => (document.body.innerText.match(/Animate/g) || []).length >= 2, { timeout: 5000 });
results.TWO_ANIMATE_ACTIONS_ADDED = true;

await page.screenshot({ path: resolve(appRoot, "scripts/parallel-before-group.png") });

// Drag the first action row's handle onto the middle of the second row to group them.
// Native HTML5 DnD isn't initiated by synthetic mouse move/down/up in Chromium
// automation, so dispatch real DragEvents directly instead.
const dragHandles = page.locator('span[title="Drag to reorder or group"]');
const handleCount = await dragHandles.count();
results.DRAG_HANDLES_FOUND = handleCount;

if (handleCount >= 2) {
  // Split into separate evaluate() calls with waits between them so React
  // actually re-renders (and updates its closures) between dragover and drop
  // — dispatching all events in one synchronous batch leaves handleDrop
  // reading stale state from before the dragover-triggered setState.
  const rowOfHandleScript = `
    (function (idx) {
      const handles = Array.from(document.querySelectorAll('span[title="Drag to reorder or group"]'));
      return handles[idx].parentElement.parentElement;
    })
  `;

  await page.evaluate((rowOfHandleSrc) => {
    const rowOf = eval(rowOfHandleSrc);
    window.__dragDt = new DataTransfer();
    const source = rowOf(0);
    source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: window.__dragDt }));
  }, rowOfHandleScript);
  await page.waitForTimeout(150);

  await page.evaluate((rowOfHandleSrc) => {
    const rowOf = eval(rowOfHandleSrc);
    const target = rowOf(1);
    const rect = target.getBoundingClientRect();
    const midX = rect.x + rect.width / 2;
    const midY = rect.y + rect.height / 2;
    target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: window.__dragDt, clientX: midX, clientY: midY }));
  }, rowOfHandleScript);
  await page.waitForTimeout(150);

  await page.evaluate((rowOfHandleSrc) => {
    const rowOf = eval(rowOfHandleSrc);
    const target = rowOf(1);
    const rect = target.getBoundingClientRect();
    const midX = rect.x + rect.width / 2;
    const midY = rect.y + rect.height / 2;
    target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: window.__dragDt, clientX: midX, clientY: midY }));
    const source = rowOf(0);
    source.dispatchEvent(new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer: window.__dragDt }));
  }, rowOfHandleScript);
  await page.waitForTimeout(300);

  const groupedText = await page.evaluate(() => document.body.innerText);
  results.GROUP_ROW_APPEARED = /Run together/i.test(groupedText);

  await page.screenshot({ path: resolve(appRoot, "scripts/parallel-after-group.png") });

  if (results.GROUP_ROW_APPEARED) {
    // Ungroup it back and confirm the group row disappears.
    const ungroupBtn = page.getByRole("button", { name: "Ungroup" });
    await ungroupBtn.click();
    await page.waitForTimeout(200);
    const ungroupedText = await page.evaluate(() => document.body.innerText);
    results.UNGROUP_OK = !/Run together/i.test(ungroupedText);
  }
} else {
  results.GROUP_ROW_APPEARED = "skipped: fewer than 2 drag handles found";
}

// Confirm the app still plays after all this editing (schema/store didn't break).
// Icon-only button; accessible name is the "▶" glyph, not "Play" — match by title instead.
await page.locator('button[title*="Preview"]').click();
await page.waitForFunction(() => document.body.innerText.includes("Welcome to Kiosk Studio"), { timeout: 5000 });
results.PLAY_OK_AFTER_EDIT = true;
await page.screenshot({ path: resolve(appRoot, "scripts/parallel-play.png") });

for (const [k, v] of Object.entries(results)) console.log(`${k}:`, v);

await app.close();
