// Ad-hoc verification: launch built app, toggle the ✨ AI assistant panel,
// confirm the API-key entry UI renders (no key configured). Run after
// `electron-vite build`. Not part of the regular smoke suite.
import { _electron as electron } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";

delete process.env.ELECTRON_RUN_AS_NODE;

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "..");

const app = await electron.launch({
  args: [appRoot, `--user-data-dir=${join(tmpdir(), "kiosk-smoke-ai-profile")}`],
  cwd: appRoot,
});
app.process().stdout?.on("data", (d) => process.stdout.write(`[main] ${d}`));
app.process().stderr?.on("data", (d) => process.stderr.write(`[main:err] ${d}`));

const page = await app.firstWindow();
page.on("console", (m) => console.log(`[renderer:${m.type()}]`, m.text()));
page.on("pageerror", (e) => console.error("[renderer:pageerror]", e));
await page.waitForLoadState("domcontentloaded");

await page.waitForFunction(
  () =>
    document.body.innerText.includes("Kiosk Studio") &&
    /add element/i.test(document.body.innerText),
  { timeout: 15000 }
);

await page.getByTitle("AI assistant").click();

await page.waitForFunction(
  () => document.body.innerText.includes("Enter your OpenAI API key to enable the assistant."),
  { timeout: 5000 }
);
console.log("AI_PANEL_KEY_PROMPT_OK: true");

await page.screenshot({ path: resolve(appRoot, "scripts/editor-ai-panel.png") });

await app.close();
