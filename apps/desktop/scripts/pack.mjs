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

// Timeout helper
function withTimeout(promise, ms, operation) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${operation} timed out after ${ms / 1000}s`)), ms)
    )
  ]);
}

// Wrap in async function to properly handle errors and satisfy Node.js's await detection
async function main() {
  try {
    // Setup staging directory
    console.log("Setting up staging directory...");
    await rm(stage, { recursive: true, force: true });
    await mkdir(stage, { recursive: true });
    console.log("  Copying build output...");
    await cp(join(appRoot, "out"), join(stage, "out"), { recursive: true });
    console.log("  Copying package.json...");
    await cp(join(appRoot, "package.json"), join(stage, "package.json"));
    console.log("✓ Staging directory ready");

    // Package the app with timeout
    console.log("Starting electron packager (5 minute timeout)...");
    console.log("  Specifying electron version and cache to avoid download hang...");

    const appPaths = await withTimeout(
      packager({
        dir: stage,
        out: outDir,
        overwrite: true,
        platform: "win32",
        arch: "x64",
        name: "Kiosk Studio",
        appCopyright: "Kiosk Studio",
        prune: false,
        electronVersion: "31.7.7", // Explicitly specify to avoid version check download
        download: {
          cache: join(appRoot, "..", "..", "node_modules", ".cache", "electron")
        },
        // extraResource removed - will copy examples manually to avoid OneDrive hang
      }),
      300000, // 5 minutes - generous timeout for OneDrive + binary download
      "Electron packaging"
    );
    console.log("✓ Packager completed!");

    console.log("✓ Packaging successful!");
    console.log("PACKAGED_TO:", appPaths.join(", "));

    // Manually copy examples to resources directory with timeout
    // This avoids the packager's problematic recursive copy on OneDrive paths
    const appPath = appPaths[0];
    const resourcesPath = join(appPath, "resources");
    const examplesSource = join(repoRoot, "examples");
    const examplesDest = join(resourcesPath, "examples");

    console.log("Copying examples directory (including user-content)...");
    await withTimeout(
      cp(examplesSource, examplesDest, { recursive: true }),
      60000, // 1 minute timeout for copy
      "Examples directory copy"
    );
    console.log("✓ Examples copied successfully");
  } finally {
    // Always clean up staging directory, even if packaging failed
    await rm(stage, { recursive: true, force: true });
  }
}

// Call main and handle any errors
main().catch((err) => {
  console.error("✗ Packaging failed:", err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
