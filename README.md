# Kiosk Studio

An Intuiface-style no-code platform for building **interactive touch kiosks** —
a visual editor + a fullscreen player, driven by a shared scene-model document.

> Status: **M3 complete.** The scene model + Player (M1), tap→navigation
> (M2 `goToScene`), and the **Composer-style visual editor (M3)** all work
> end-to-end: drag/resize elements, a properties panel, a Scene Structure layer
> tree, multi-scene management, and Save/Open with a ▶ Play preview. Data
> connectors (M4) are next. See the plan in `~/.claude/plans/` for the roadmap.

## Architecture

The **Scene Model** (`packages/engine/src/model/`) is the contract: a Project has
Scenes, a Scene has Elements, Elements carry props + data bindings + interactions
(trigger → actions). The **Player** reads it, the **Editor** (coming) writes it,
and **connectors** (coming) feed live values into it.

```
packages/engine/      scene model + Zod schema, DOM renderer, interaction runtime
packages/connectors/  (M4) file / rest / mqtt / ws / serial / ble connectors
apps/desktop/         Electron app — Player now, Editor mode in M3
examples/hello.kproj/ hand-authored sample project (renders before any editor exists)
```

## Develop

```bash
corepack enable pnpm      # one-time, uses the pinned pnpm version
pnpm install
pnpm dev                  # launches the Electron app, loads examples/hello.kproj
pnpm -r typecheck
```

### ELECTRON_RUN_AS_NODE (handled automatically)

If `ELECTRON_RUN_AS_NODE=1` is present in the environment (some Electron-as-Node
tooling sets it, and child processes inherit it), the Electron binary runs as
plain Node, never registers its runtime `electron` module, and **never opens a
window** — launches fail silently with `app.whenReady` being undefined.

You don't need to do anything: `dev`, `preview`, and `smoke` all route through
`scripts/launch.mjs` (and `scripts/smoke.mjs`), which delete the var from the
spawned Electron process's environment. The app launches correctly regardless
of who starts it.

## Package a shareable Windows app

```bash
pnpm --filter @kiosk/desktop package
```

Produces `apps/desktop/dist/Kiosk Studio-win32-x64/` containing **`Kiosk Studio.exe`**
plus the Electron runtime and the bundled example project. To share with coworkers:

1. **Zip** the whole `Kiosk Studio-win32-x64` folder.
2. They **unzip** anywhere and double-click **`Kiosk Studio.exe`** — no install, no admin.
3. First launch shows a Windows SmartScreen "unknown publisher" warning (the build is
   unsigned). They click **More info → Run anyway**. (Sign the exe later to remove this.)

Notes:
- Uses **@electron/packager** (not electron-builder): electron-builder's signing
  toolchain needs admin/Developer-Mode symlinks, which aren't available here. Packager
  needs neither and produces a runnable folder.
- The example loads from `resources/examples/` (bundled). Projects users save go to
  `Documents/KioskStudio/`.
- For a true kiosk deploy, make a shortcut to the exe with `--kiosk <path-to-project.json>`.

### Publishing an update

The app checks this repo's latest GitHub Release at launch (and every 6 hours) and
offers it from the TopBar's update button. With **Update automatically** on, it downloads
in the background and installs when the app closes. For a build to be found and installable:

1. Bump `version` in `apps/desktop/package.json` — that is the version the app compares against.
2. Package, zip the `Kiosk Studio-win32-x64` folder, and publish a release tagged `v<version>`
   (e.g. `v0.10.0`). Drafts and pre-releases are ignored.
3. The zip's filename must contain `win32-x64` and end in `.zip`
   (e.g. `Kiosk-Studio-v0.10.0-win32-x64.zip`).

Installing replaces the app's own files only; `Exports/`, `user-content/` and `analytics/`
beside the exe are left alone. A log is written to `%AppData%\Kiosk Studio\update.log`.

## Verify

```bash
pnpm --filter @kiosk/desktop build
pnpm --filter @kiosk/desktop smoke      # builds output must exist; drives the app with Playwright
```

`smoke` launches the built app and asserts: the editor loads, adding a palette
element selects it, a Save→reload round trip through the IPC bridge persists the
edit, and ▶ Play renders the edited project in the real Player. Screenshots:
`apps/desktop/scripts/editor.png` / `editor-play.png`.
