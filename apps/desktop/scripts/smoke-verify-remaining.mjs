// Covers the 3 remaining manual-verification items from the parallel-actions
// plan that smoke-parallel.mjs didn't touch:
//  1. Loading an existing pre-change project (no action ids) -> no schema
//     errors, ids get backfilled by Zod's .default() on parse.
//  2. Scene hierarchy view still finds a goToScene link once it's nested
//     inside a "parallel" group (exercises the flattenActions fix in
//     sceneHierarchy.ts).
//  3. enterScene interactions on 2+ elements now animate concurrently
//     instead of staggered (exercises the Player.tsx rewrite).
//
// Drives the store directly via the __kioskParse/__kioskTestLoad/__kioskState
// test hooks in App.tsx instead of the file-open dialog (which Playwright
// can't drive) or DnD simulation (already covered in smoke-parallel.mjs).
// Run after `electron-vite build` (pnpm -r build).
import { _electron as electron } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";

delete process.env.ELECTRON_RUN_AS_NODE;

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "..");
const demoPath = resolve(appRoot, "../../Exports/kioskDemo.json");
const demoRaw = readFileSync(demoPath, "utf8");

const app = await electron.launch({
  args: [appRoot, `--user-data-dir=${join(tmpdir(), "kiosk-smoke-verify-remaining-profile")}`],
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

// --- 1. Load the pre-change demo project (actions have no "id" field) ---
const loadOutcome = await page.evaluate((raw) => {
  try {
    const parsed = window.__kioskParse(JSON.parse(raw));
    window.__kioskTestLoad(parsed, "C:/fake/kioskDemo.json");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}, demoRaw);
results.OLD_PROJECT_PARSED_AND_LOADED = loadOutcome.ok ? true : loadOutcome.error;

await page.waitForFunction(() => document.body.innerText.includes("Welcome Text") || document.body.innerText.includes("Home"), {
  timeout: 5000,
});

const idBackfill = await page.evaluate(() => {
  const project = window.__kioskProject;
  const ids = [];
  const missing = [];
  for (const scene of project.scenes) {
    for (const el of scene.elements) {
      for (const interaction of el.interactions) {
        for (const action of interaction.actions) {
          if (!action.id) missing.push(`${el.id}/${interaction.id}/${action.type}`);
          else ids.push(action.id);
        }
      }
    }
  }
  return { total: ids.length, missing };
});
results.OLD_PROJECT_ACTIONS_BACKFILLED_IDS =
  idBackfill.total > 0 && idBackfill.missing.length === 0
    ? `ok (${idBackfill.total} actions, all have ids)`
    : `FAIL: missing ids on ${JSON.stringify(idBackfill.missing)}`;

// --- 2. Scene hierarchy: goToScene link survives being grouped into "parallel" ---
// Find the element (in the active/home scene) whose tap trigger has a goToScene
// action, then wrap that action in a parallel group via the store directly.
const groupOutcome = await page.evaluate(() => {
  const state = window.__kioskState(); // action methods are stable refs; re-fetch .project fresh after each mutation
  const scene0 = state.project.scenes.find((s) => s.id === state.activeSceneId) ?? state.project.scenes[0];
  for (const el of scene0.elements) {
    for (const interaction of el.interactions) {
      const goTo = interaction.actions.find((a) => a.type === "goToScene");
      if (goTo) {
        // Give it a sibling action so groupActions has two ids to combine.
        state.addAction(el.id, interaction.id, { type: "toggle", params: {} });
        const after = window
          .__kioskState()
          .project.scenes.find((s) => s.id === state.activeSceneId)
          .elements.find((e) => e.id === el.id)
          .interactions.find((i) => i.id === interaction.id);
        const toggleAction = after.actions.find((a) => a.type === "toggle");
        state.groupActions(el.id, interaction.id, goTo.id, toggleAction.id);
        return { ok: true, elementId: el.id, sceneId: scene0.id, targetSceneId: goTo.params.sceneId };
      }
    }
  }
  return { ok: false };
});
results.GOTOSCENE_GROUPED_INTO_PARALLEL = groupOutcome.ok
  ? `ok (element ${groupOutcome.elementId}, scene ${groupOutcome.sceneId} -> ${groupOutcome.targetSceneId})`
  : "FAIL: no goToScene action found in demo project to group";

if (groupOutcome.ok) {
  // Confirm the store-level cleanup/hierarchy code actually sees the nested
  // action: flattenActions over the interaction's actions should still surface it.
  const stillVisible = await page.evaluate((targetSceneId) => {
    const state = window.__kioskState();
    const scene = state.project.scenes.find((s) => s.id === state.activeSceneId);
    for (const el of scene.elements) {
      for (const interaction of el.interactions) {
        for (const action of interaction.actions) {
          if (action.type === "parallel") {
            const nested = action.params.actions || [];
            if (nested.some((a) => a.type === "goToScene" && a.params.sceneId === targetSceneId)) return true;
          }
        }
      }
    }
    return false;
  }, groupOutcome.targetSceneId);
  results.GOTOSCENE_NESTED_IN_STORE = stillVisible;

  // Now check the actual Project/hierarchy panel UI renders the link.
  await page.getByText("Project", { exact: true }).click();
  await page.waitForTimeout(300);
  const hierarchyText = await page.evaluate(() => document.body.innerText);
  results.HIERARCHY_PANEL_TEXT_SAMPLE = hierarchyText.slice(0, 400);
  await page.screenshot({ path: resolve(appRoot, "scripts/verify-hierarchy.png") });
}

// --- 3. enterScene concurrency across elements ---
// Add an enterScene animate(opacity 0->1, 1200ms) interaction to two different
// elements, enter Play, and sample both elements' opacity shortly after start.
// If they run staggered (old bug), the 2nd element wouldn't have started
// animating yet at the sample point; if concurrent (fix), both should show
// partial progress at the same time.
const concurrencySetup = await page.evaluate(() => {
  const state = window.__kioskState(); // action methods are stable refs; re-fetch .project fresh after each mutation
  // Use freshly-added plain rectangles (no external asset dependency) rather than
  // the demo project's image element, whose asset fails to resolve under the fake
  // load path used above and would otherwise skew the opacity-progress timing.
  const targets = [];
  for (let i = 0; i < 2; i++) {
    state.addElement("rectangle");
    const id = window.__kioskState().selectedId;
    targets.push({ id });
  }
  if (targets.length < 2) return { ok: false, reason: `only ${targets.length} elements in scene` };
  for (const el of targets) {
    state.addInteraction(el.id, "enterScene");
    const freshEl = window
      .__kioskState()
      .project.scenes.find((s) => s.id === state.activeSceneId)
      .elements.find((e) => e.id === el.id);
    const interaction = freshEl.interactions.find((i) => i.trigger === "enterScene");
    state.addAction(el.id, interaction.id, {
      type: "animate",
      params: { target: el.id, property: "opacity", from: 0, to: 1, duration: 1200, easing: "linear" },
    });
  }
  return { ok: true, ids: targets.map((e) => e.id) };
});
results.ENTERSCENE_SETUP = concurrencySetup.ok ? `ok (${JSON.stringify(concurrencySetup.ids)})` : `FAIL: ${concurrencySetup.reason}`;

if (concurrencySetup.ok) {
  const [idA, idB] = concurrencySetup.ids;
  await page.locator('button[title*="Preview"]').click();
  await page.waitForFunction(() => document.body.innerText.includes("Kiosk Studio"), { timeout: 5000 });

  // Sample both elements' opacity ~300ms into a 1200ms animation.
  await page.waitForTimeout(300);
  const sample = await page.evaluate(([a, b]) => {
    const read = (id) => {
      const node = document.querySelector(`[data-element-id="${id}"]`);
      if (!node) return null;
      return parseFloat(getComputedStyle(node).opacity);
    };
    return { a: read(a), b: read(b) };
  }, [idA, idB]);
  results.ENTERSCENE_SAMPLE_AT_300MS = sample;
  // Concurrent = both elements partway through the fade (neither exactly 0 nor stuck at initial).
  results.ENTERSCENE_CONCURRENT =
    sample.a !== null && sample.b !== null && sample.a > 0.05 && sample.a < 0.98 && sample.b > 0.05 && sample.b < 0.98
      ? true
      : `possible stagger or read failure: ${JSON.stringify(sample)}`;

  await page.screenshot({ path: resolve(appRoot, "scripts/verify-enterscene.png") });
}

for (const [k, v] of Object.entries(results)) console.log(`${k}:`, typeof v === "object" ? JSON.stringify(v) : v);

await app.close();
