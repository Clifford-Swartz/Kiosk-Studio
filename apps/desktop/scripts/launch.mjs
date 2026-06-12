// Shared launcher for the desktop app's electron-vite commands.
//
// Why this exists: if ELECTRON_RUN_AS_NODE is set in the environment (some
// Electron-as-Node tooling sets it for itself and child processes inherit it),
// the Electron binary runs as plain Node and never opens a window. Unsetting it
// here means `dev`/`preview`/`start` launch correctly no matter who runs them.
import { spawn } from "node:child_process";

const sub = process.argv[2]; // "dev" | "preview" | "build" | ...
if (!sub) {
  console.error("usage: node scripts/launch.mjs <electron-vite-subcommand>");
  process.exit(1);
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

// Resolve the local electron-vite bin cross-platform via npm's exec.
const cmd = process.platform === "win32" ? "npx.cmd" : "npx";
const child = spawn(cmd, ["electron-vite", sub], {
  stdio: "inherit",
  env,
  shell: true,
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
