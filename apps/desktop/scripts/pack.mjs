// Package Kiosk Studio into a runnable Windows app folder using
// @electron/packager (no electron-builder / winCodeSign / symlink/admin needs).
// Output: dist/Kiosk Studio-win32-x64/Kiosk Studio.exe  — zip & share.
//
// Run AFTER `electron-vite build` (so out/ exists). `pnpm package` does both.
import { packager } from "@electron/packager";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { cp, rm, mkdir } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "..");
const repoRoot = resolve(appRoot, "..", "..");
const outDir = join(appRoot, "dist");

// Stage a clean app dir containing only what the packaged app needs: the built
// out/ (main+preload+renderer; workspace deps are inlined) and package.json
// (for "main" + metadata). No node_modules — nothing else is required at runtime.
const stage = join(appRoot, ".pack-stage");
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await cp(join(appRoot, "out"), join(stage, "out"), { recursive: true });
await cp(join(appRoot, "package.json"), join(stage, "package.json"));

const appPaths = await packager({
  dir: stage,
  out: outDir,
  overwrite: true,
  platform: "win32",
  arch: "x64",
  name: "Kiosk Studio",
  appCopyright: "Kiosk Studio",
  prune: false,
  // Copy the example project into resources/examples (sibling of the app),
  // which is process.resourcesPath at runtime — matches main's lookup.
  extraResource: [join(repoRoot, "examples")],
});

await rm(stage, { recursive: true, force: true });
console.log("PACKAGED_TO:", appPaths.join(", "));
