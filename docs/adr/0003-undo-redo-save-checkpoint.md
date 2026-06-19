# 3. Undo/Redo with Save-as-Checkpoint Model

Date: 2026-06-19

## Status

Accepted

## Context

Original undo/redo system had bugs:

1. **Keyboard shortcut stale refs** - Custom useEffect listener set up once with empty deps, refs updated in separate effect → shortcuts used old callbacks when undo/redo actions changed
2. **History survived project load** - Opening new file retained previous project's undo stack → undo could restore wrong project state
3. **Dirty flag drift** - 50-entry FIFO shifted `savedHistoryIndex`, broke dirty calculation after ~50 edits
4. **Selection always cleared** - Undo/redo always set `selectedId: null` even when element still existed in restored project

Mental model confusion:

- Old system: Save = persist to disk, history survives, dirty tracks "current ≠ saved" via `savedHistoryIndex`
- Problem: After 50+ edits, FIFO shift breaks index tracking. Users expect save to "commit" state, not just write to disk.

## Decision

Adopt **save-as-checkpoint model** with simplified dirty tracking:

### 1. Clear History on Save

`markSaved()` clears `undoHistory[]`, resets `undoHistoryIndex` to -1, removes `savedHistoryIndex` field entirely. Save = checkpoint, wipe slate.

**Trade-off:** Can't undo past save point. Acceptable because:
- Kiosk projects are deliberate design workflows (not freeform text editing where undo-past-save helps)
- Users save when reaching stable state (milestone commit)
- Simplifies mental model (save = "lock this version in")

### 2. Dirty = History Non-Empty

Old: `dirty = undoHistoryIndex !== savedHistoryIndex`  
New: `dirty = undoHistory.length > 0`

After save clears history:
- Make edit → snapshot captured → `dirty: true`
- Undo edit → history empty → `dirty: false` (back to saved checkpoint)

**Why simpler:**
- No `savedHistoryIndex` to track through FIFO shifts
- Dirty invariant: "history exists" = "unsaved changes exist"
- No drift bugs after 50+ edits

### 3. Clear History on Project Load

`loadProject()` clears history to prevent undo from mixing Project A and Project B state.

### 4. Preserve Selection if Element Exists

After undo/redo, check if `selectedId` still exists in restored project:
```typescript
const elementExists = restored.scenes
  .find(s => s.id === activeSceneId)
  ?.elements.some(e => e.id === selectedId);

selectedId: elementExists ? selectedId : null
```

**Why better UX:** User undoes property change → element still selected → can immediately continue editing. Old behavior (always clear) forced reselection.

### 5. Use useKeyboardShortcuts Hook

Replace custom keyboard listener with existing `useKeyboardShortcuts` hook (same as EditorShell uses for Mod+S/P/K):

```typescript
useKeyboardShortcuts({
  "Mod+Z": { action: undo, description: "Undo", enabled: canUndo },
  "Mod+Shift+Z": { action: redo, description: "Redo", enabled: canRedo },
  "Mod+Y": { action: redo, description: "Redo (alt)", enabled: canRedo },
});
```

**Why safer:** Hook recreates listeners when `undo`/`redo` callbacks change (proper deps). No stale ref bug.

### 6. Deselect on Save

`markSaved()` sets `selectedId: null` (clear selection when saving), keeps `activeSceneId` unchanged (stay in current scene).

**Rationale:** Save = checkpoint, clean slate. Clearing selection reinforces "committed state" moment.

## Consequences

**Positive:**
- ✅ No savedHistoryIndex tracking complexity
- ✅ Dirty flag never drifts (simple invariant)
- ✅ History cleared on load prevents project mixing
- ✅ Selection preserved improves editing flow
- ✅ Keyboard shortcuts fixed via useKeyboardShortcuts
- ✅ Clear mental model (save = checkpoint + history reset)

**Negative:**
- ❌ Can't undo past save point (trade-off for simplicity)
- ❌ One extra hook call in useUndoRedo (useKeyboardShortcuts), but eliminates 40 lines of custom listener code

**Neutral:**
- Snapshot-based approach unchanged (full Project clones, 50-entry FIFO cap)
- Pause/resume during drag unchanged (prevent 100s of snapshots per drag)
- 50ms debounce unchanged (groups rapid edits)

## Alternatives Considered

### 1. Keep History Through Save (Old Behavior)

**Pros:** Can undo past save point (more forgiving for experimentation)  
**Cons:** savedHistoryIndex drift after 50+ edits, complex dirty tracking, confusing mental model (when does history end?)

**Rejected:** Drift bug unfixable without unbounded history or complex index shift logic. Clear-on-save simpler.

### 2. Operation-Based Undo (Command Pattern)

**Pros:** Memory-efficient (record inverse ops, not full snapshots)  
**Cons:** Complex inverse logic for nested updates (bindings, interactions, groups), stale element ID handling, no simpler than snapshot approach for 50-entry cap (~2.5-5MB memory acceptable).

**Rejected:** Premature optimization. Snapshot approach works, 50 entries sufficient for editing sessions.

### 3. Fix Keyboard Shortcuts with Deps Array

**Approach:** Add `[undo, redo]` to useEffect deps, recreate listener when callbacks change.

**Pros:** Minimal change to existing pattern.  
**Cons:** Still custom listener code (40 lines), duplicates useKeyboardShortcuts functionality, doesn't match codebase convention (EditorShell uses useKeyboardShortcuts).

**Rejected:** useKeyboardShortcuts is the codebase standard. Consolidate on one pattern.

## Implementation Notes

**Files modified:**
- `apps/desktop/src/renderer/editor/store.ts` - remove savedHistoryIndex, update markSaved/loadProject/undo/redo
- `apps/desktop/src/renderer/editor/useUndoRedo.ts` - replace custom listener with useKeyboardShortcuts

**Verification:**
1. Save → history cleared, undo/redo disabled
2. Edit after save → dirty on, undo → dirty off
3. Select element → undo preserves selection if element exists
4. Load project → history cleared
5. Ctrl/Cmd+Z/Shift+Z/Y work immediately after edits

**Rollback:** Revert store.ts + useUndoRedo.ts. Changes isolated to undo/redo subsystem.

## Related

- CONTEXT.md § "Undo/Redo System (2026-06)" documents new contract
- useKeyboardShortcuts hook: `apps/desktop/src/renderer/hooks/useKeyboardShortcuts.ts`
