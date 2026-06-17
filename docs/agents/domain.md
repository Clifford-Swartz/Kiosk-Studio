# Domain Docs

Kiosk Studio uses a **single-context** layout for domain documentation:

- One `CONTEXT.md` at the repo root (describes the whole project)
- One `docs/adr/` directory at the repo root (architectural decisions for all packages)

This applies to both `apps/desktop/` and `packages/engine/`.

## For agents

When reading domain language or architectural decisions:

1. Read `CONTEXT.md` at the repo root for terminology, key concepts, and project overview
2. Check `docs/adr/` for past decisions that constrain current work

Both files are the single source of truth — there are no per-package contexts.

## Updating these docs

- `CONTEXT.md` should grow as the project evolves: add new terms, clarify relationships, document key invariants
- `docs/adr/` should capture decisions that matter to future work (e.g., why Electron over web, why TypeScript, schema versioning choices)
- Skills like `improve-codebase-architecture` and `grill-with-docs` will read these and challenge them; keep them honest
