# Undo/Redo Debug Guide

## What Was Fixed

Consolidated `useUndoRedo` from multiple instances (Canvas.tsx and TopBar.tsx) to a single instance in EditorShell.tsx.

## What to Look For When Testing

### 1. Mount Verification
**Expected:** Console should show `[useUndoRedo] mounted - should only see this once` **exactly twice** when the editor loads (in development mode).

**Why twice?** React.StrictMode in development intentionally double-mounts components to help detect side effects. This is normal and expected. In production builds, it will only mount once.

**The important part:** After the initial double-mount, you should NOT see this log again during normal use (dragging, editing, etc.). If you see it during normal operations, that means EditorShell is remounting, which would be a problem.

**Problem if:** You see it more than twice on initial load, or you see it again during normal editor operations.

### 2. Drag Behavior
When you start dragging an element:
- **Expected:** `[useUndoRedo] pauseCapture called`
- During drag: `[useUndoRedo] Skipping capture - paused` (if project updates trigger the effect)
- When you release: `[useUndoRedo] resumeCapture called`
- Shortly after: `[useUndoRedo] Capturing history` (capturing the final position)

**Problem if:**
- You see `pauseCapture` multiple times = Still have multiple hook instances
- You see `Capturing history` during the drag = `pauseCapture` isn't working or isn't being called
- You never see `pauseCapture` = Canvas isn't receiving the props correctly

### 3. Undo/Redo Keyboard Shortcuts
Press Ctrl+Z:
- **Expected:** Undo happens once
- **Problem if:** Undo happens multiple times = Multiple keyboard listeners still active

## Current Logging

I've added temporary debug logs to:
- Track when the hook mounts (useEffect with empty deps)
- Log when pauseCapture is called
- Log when resumeCapture is called
- Log when capture is skipped due to pause
- Log when history is actually captured (with reason)

## Removing Debug Logs

Once you've verified the fix works, remove these console.log statements from `useUndoRedo.ts`:
1. Line ~23: `console.log('[useUndoRedo] mounted - should only see this once');`
2. Line ~34: `console.log('[useUndoRedo] Skipping capture - paused');`
3. Line ~59: `console.log('[useUndoRedo] Capturing history...`
4. Line ~146: `console.log('[useUndoRedo] pauseCapture called');`
5. Line ~158: `console.log('[useUndoRedo] resumeCapture called');`

## Next Steps If Issue Persists

If you still see the hook mounting multiple times or history capturing during drags:

1. **Check if EditorShell itself is remounting**: Add a log at the top of EditorShell's function body
2. **Check React DevTools**: Look for duplicate components in the tree
3. **Verify no hot-reload issues**: Sometimes dev mode can cause double-mounting (React.StrictMode)
4. **Check if pauseCapture/resumeCapture are the same function**: Log their identity in Canvas
