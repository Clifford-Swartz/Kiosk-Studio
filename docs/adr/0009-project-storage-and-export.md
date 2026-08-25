# ADR 0009: Project Storage and Export Architecture

**Status:** Accepted (2026-07-01)

## Context

Kiosk Studio projects need to support two workflows:
1. **Authoring** — user builds project, references assets from shared library
2. **Distribution** — exported bundle with all assets packaged, ready to share/deploy

Prior model: Per-project `user-content/` folders next to each `.json` file. Problems:
- Assets duplicated across projects (same logo copied 5 times)
- No clear distribution artifact (share folder? zip manually?)
- Projects scattered across filesystem (Documents/, Desktop/, arbitrary locations)
- Kiosk deployments need portable structure (copy one folder to kiosk machine)

Target deployment: Portable app (zip with .exe + relative paths). No installer, no Program Files, no registry. Copy app folder to USB/kiosk machine and run.

## Decision

### Folder Structure

```
<app-dir>/
├── KioskStudio.exe
├── resources/
│   └── placeholders/          ← bundled placeholder images/video/audio
├── user-content/              ← shared asset library (all projects)
│   ├── logo.png
│   └── video.mp4
└── Exports/
    ├── demo.kproj/            ← working project
    │   ├── project.json       "src": "user-content/logo.png"
    │   └── assets/            (placeholders only)
    │       └── placeholder.png
    └── demo-exported.kproj/   ← bundled export
        ├── project.json       "src": "assets/logo.png", "exported": true
        └── assets/            (placeholders + user-content merged)
            ├── placeholder.png
            └── logo.png
```

### Asset Routing Rules

**To `user-content/`** (app-root shared library):
- File → "Choose image/video/audio" picker
- Paste from clipboard
- Drag-and-drop from filesystem

**To `assets/`** (project-specific):
- Placeholders (copied from `resources/placeholders/` on New Project)
- Bundled assets (copied from `user-content/` during Export)
- PPTX import images — extracted directly from the deck's media parts, not
  drawn from (or reusable via) the shared library, so they're written
  straight into the importing project's `assets/` rather than deduplicated
  into `user-content/`

### Export Behavior

Export action (`File → Export Project`):
1. Create `{projectName}-exported.kproj/` sibling folder
2. Copy `project.json` → rewrite all paths:
   - `"src": "user-content/file.ext"` → `"src": "assets/file.ext"`
   - `"src": "assets/placeholder.png"` → unchanged (already bundled)
   - External URLs unchanged
3. Copy all referenced files from `user-content/` into `assets/`
4. Handle name collisions via deduplication (`logo.png`, `logo_1.png`, etc.)
5. Set `"exported": true` in schema
6. Open file explorer to show export location

Re-exporting: Prompt "demo-exported.kproj exists. Overwrite?" (default No, offer rename).

Exporting an already-exported project: Re-bundle any new `user-content/` refs into `assets/`.

### Path Resolution

**Protocol handler (`kioskasset://`) logic:**
- Detect project location (inside `Exports/` subfolder)
- If `"exported": false` or undefined:
  - `assets/` → resolve from `{project-dir}/assets/`
  - `user-content/` → resolve from `<app-dir>/user-content/`
- If `"exported": true`:
  - `assets/` → resolve from `{project-dir}/assets/` (contains bundled copy)
  - `user-content/` → should not exist (all rewritten during export)

Base resolution uses app root for shared folders, project dir for bundled assets.

### Schema Changes

Add optional `exported?: boolean` field to Project schema (defaults `false`).

```typescript
type Project = {
  schemaVersion: 3;
  id: string;
  name: string;
  exported?: boolean;  // true = bundled export, false/undefined = working
  // ... rest of schema
}
```

## Consequences

**Positive:**
- ✅ **Single asset library** — no duplication, users manage one folder
- ✅ **Clear distribution artifacts** — `-exported.kproj` is the sharable unit
- ✅ **Portable deployments** — copy `Exports/demo-exported.kproj/` to another machine, self-contained
- ✅ **Discoverable location** — all projects in `Exports/`, not scattered filesystem
- ✅ **Re-export workflow** — edit working copy, re-export updates bundled version

**Negative:**
- ⚠️ **Breaking change** — existing projects with per-project `user-content/` need migration
- ⚠️ **Shared library management** — deleting from `user-content/` affects all projects (need "in-use" detection?)
- ⚠️ **Export overhead** — large projects copy many files (multi-GB video collections slow)

**Mitigations:**
- Migration tool: scan existing projects, consolidate `user-content/` folders into shared library, update paths
- In-use detection: before deleting from `user-content/`, scan all `.kproj` files for references (show warning)
- Incremental export: track last-exported timestamp, only re-copy changed files (future optimization)

## Alternatives Considered

**Option A: Keep per-project user-content/**, add Export as zip
- Rejected: Doesn't solve duplication, zip/unzip adds complexity, editing zipped projects awkward

**Option B: Database-backed asset store** (SQLite with blob storage)
- Rejected: Overkill for kiosk scale, loses filesystem transparency (hard to debug/backup)

**Option C: Symlinks from project assets/ to shared user-content/**
- Rejected: Windows symlink support spotty (requires admin), breaks on copy/move, confusing UX

## Related

- See `packages/engine/src/model/schema.ts` for Project schema definition
- See `apps/desktop/src/main/index.ts` for kioskasset:// protocol handler
- See `apps/desktop/src/renderer/editor/assets.ts` for asset import logic
- See `apps/desktop/src/renderer/editor/pptxImport.ts` for PPTX import, which
  writes extracted images to `assets/` (see Asset Routing Rules above)
