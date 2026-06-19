import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor } from "./store.js";
import type { Project } from "@kiosk/engine";

const MAX_HISTORY_SIZE = 50;

/**
 * Snapshot-based undo/redo for the editor. Full Project clones are kept in a
 * ref-backed ring (capped at MAX_HISTORY_SIZE). History lives here, NOT in the
 * store — the store only exposes a `historyNonce` we watch to know when to wipe
 * the slate (on save or project load) and a `restoreFromHistory` action that
 * applies a snapshot without marking dirty or re-triggering capture.
 *
 * Model: save-as-checkpoint (ADR 0003). Saving or loading clears history, so
 * you can't undo past a save. `dirty` is simply "history is non-empty" — no
 * savedHistoryIndex to drift as the ring shifts.
 *
 * Returns undo/redo callbacks plus pauseCapture/resumeCapture, which the Canvas
 * uses to avoid recording hundreds of intermediate snapshots during a drag.
 */
export function useUndoRedo() {
  const history = useRef<Project[]>([]);
  const historyIndex = useRef(-1);
  const skipTrackingRef = useRef(false);
  const isCapturingRef = useRef(true);
  const captureTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const project = useEditor((s) => s.project);
  const activeSceneId = useEditor((s) => s.activeSceneId);
  const historyNonce = useEditor((s) => s.historyNonce);
  const restoreFromHistory = useEditor((s) => s.restoreFromHistory);
  const prevSceneRef = useRef(activeSceneId);

  /** Reflect history position into the can-undo/redo button state. */
  const syncFlags = useCallback(() => {
    setCanUndo(historyIndex.current > 0);
    setCanRedo(historyIndex.current < history.current.length - 1);
  }, []);

  // Add a snapshot to history (used by the tracking effect and resumeCapture).
  const captureSnapshot = useCallback(
    (snapshot: Project) => {
      // Drop any redo entries — we've branched off the old future.
      history.current = history.current.slice(0, historyIndex.current + 1);
      history.current.push(snapshot);
      historyIndex.current += 1;

      // Bound the ring. Shifting the base is safe now that `dirty` is derived
      // from emptiness, not a saved index (ADR 0003).
      if (history.current.length > MAX_HISTORY_SIZE) {
        history.current.shift();
        historyIndex.current = Math.max(0, historyIndex.current - 1);
      }

      syncFlags();
    },
    [syncFlags],
  );

  // Save-as-checkpoint: when the store bumps historyNonce (save or load) — and
  // once on mount — wipe history and re-seed the baseline from the CURRENT
  // project. Seeding here (not lazily on first edit) means the first real edit
  // becomes history entry #2, so canUndo flips true immediately. We read the
  // live project via getState() so this effect doesn't need it as a dependency.
  useEffect(() => {
    const cur = useEditor.getState();
    history.current = [cur.project];
    historyIndex.current = 0;
    isCapturingRef.current = true;
    skipTrackingRef.current = false;
    prevSceneRef.current = cur.activeSceneId;
    setCanUndo(false);
    setCanRedo(false);
  }, [historyNonce]);

  // Track project changes and append to history.
  useEffect(() => {
    // Skip the change caused by our own restore (undo/redo).
    if (skipTrackingRef.current) {
      skipTrackingRef.current = false;
      return;
    }

    // Paused during a drag/resize — Canvas captures the final state on release.
    if (!isCapturingRef.current) return;

    // No baseline yet (shouldn't happen — the wipe effect seeds it — but guard).
    if (history.current.length === 0) {
      history.current.push(project);
      historyIndex.current = 0;
      return;
    }

    const sceneChanged = prevSceneRef.current !== activeSceneId;
    prevSceneRef.current = activeSceneId;

    const current = history.current[historyIndex.current];
    // Same project object and same scene → nothing actually changed; skip.
    if (current === project && !sceneChanged) return;

    captureSnapshot(project);
  }, [project, activeSceneId, captureSnapshot]);

  const undo = useCallback(() => {
    if (historyIndex.current <= 0) return;
    historyIndex.current -= 1;
    skipTrackingRef.current = true;
    restoreFromHistory(history.current[historyIndex.current]);
    syncFlags();
  }, [restoreFromHistory, syncFlags]);

  const redo = useCallback(() => {
    if (historyIndex.current >= history.current.length - 1) return;
    historyIndex.current += 1;
    skipTrackingRef.current = true;
    restoreFromHistory(history.current[historyIndex.current]);
    syncFlags();
  }, [restoreFromHistory, syncFlags]);

  const pauseCapture = useCallback(() => {
    isCapturingRef.current = false;

    // Failsafe: auto-resume if a drag is interrupted (e.g. pointer leaves window
    // and we never get the pointerup) so capture can't get stuck off.
    clearTimeout(captureTimeoutRef.current);
    captureTimeoutRef.current = setTimeout(() => {
      isCapturingRef.current = true;
    }, 5000);
  }, []);

  const resumeCapture = useCallback(() => {
    clearTimeout(captureTimeoutRef.current);
    isCapturingRef.current = true;

    // The project ref hasn't changed since we paused, so the tracking effect
    // won't fire — capture the final post-drag state explicitly.
    const currentProject = useEditor.getState().project;
    const current = history.current[historyIndex.current];
    if (current !== currentProject && history.current.length > 0) {
      captureSnapshot(currentProject);
    }
  }, [captureSnapshot]);

  return { undo, redo, canUndo, canRedo, pauseCapture, resumeCapture };
}
