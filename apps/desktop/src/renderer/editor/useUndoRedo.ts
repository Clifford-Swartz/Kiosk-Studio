import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor } from "./store.js";
import type { Project } from "@kiosk/engine";

const MAX_HISTORY_SIZE = 50;
const CAPTURE_DEBOUNCE = 50; // 50ms between captures to catch missed intermediate states

export function useUndoRedo() {
  const history = useRef<Project[]>([]);
  const historyIndex = useRef(-1);
  const skipTrackingRef = useRef(false);
  const isCapturingRef = useRef(true);
  const lastCaptureTime = useRef(0);
  const captureTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const project = useEditor((s) => s.project);
  const activeSceneId = useEditor((s) => s.activeSceneId);
  const loadProject = useEditor((s) => s.loadProject);
  const prevSceneRef = useRef(activeSceneId);

  // Log only on mount, not on every render
  useEffect(() => {
    console.log('[useUndoRedo] mounted - should only see this once');
  }, []);

  // Shared function to add a snapshot to history (used by both the effect and resumeCapture)
  const captureSnapshot = useCallback((snapshot: Project) => {
    console.log('[useUndoRedo] Capturing snapshot to history');

    // Truncate any redo history if we've branched
    history.current = history.current.slice(0, historyIndex.current + 1);

    // Add new state to history
    history.current.push(snapshot);
    historyIndex.current += 1;

    // Enforce history size limit
    if (history.current.length > MAX_HISTORY_SIZE) {
      history.current.shift();
      historyIndex.current = Math.max(0, historyIndex.current - 1);
    }

    setCanUndo(historyIndex.current > 0);
    setCanRedo(historyIndex.current < history.current.length - 1);
    lastCaptureTime.current = Date.now();
  }, []);

  // Track project changes and add to history
  useEffect(() => {
    console.log('[useUndoRedo] History effect triggered - skipTracking:', skipTrackingRef.current, 'isCapturing:', isCapturingRef.current);

    // Skip if undo/redo just restored a state
    if (skipTrackingRef.current) {
      skipTrackingRef.current = false;
      console.log('[useUndoRedo] Skipping - just restored state');
      return;
    }

    // Skip if history capture is paused (e.g., during drag operations)
    if (!isCapturingRef.current) {
      console.log('[useUndoRedo] Skipping capture - paused');
      return;
    }

    // Skip if we're at the start (history is empty)
    if (history.current.length === 0) {
      history.current.push(project);
      historyIndex.current = 0;
      lastCaptureTime.current = Date.now();
      setCanUndo(false);
      setCanRedo(false);
      return;
    }

    // Check if scene changed (force capture even if project ref same)
    const sceneChanged = prevSceneRef.current !== activeSceneId;
    prevSceneRef.current = activeSceneId;

    // Timestamp-based capture check: Allow capture if reference changed OR enough time passed OR scene changed
    const now = Date.now();
    const timeSinceLastCapture = now - lastCaptureTime.current;
    const current = history.current[historyIndex.current];

    // Skip if ALL conditions are false:
    // 1. Reference hasn't changed (same project object)
    // 2. Not enough time has passed (less than debounce window)
    // 3. Scene hasn't changed
    const shouldCapture = current !== project || timeSinceLastCapture > CAPTURE_DEBOUNCE || sceneChanged;

    if (!shouldCapture) {
      return;
    }

    console.log('[useUndoRedo] Capturing history - isCapturingRef:', isCapturingRef.current, 'refChanged:', current !== project, 'timeSince:', timeSinceLastCapture);

    captureSnapshot(project);
  }, [project, activeSceneId, captureSnapshot]);

  const undo = useCallback(() => {
    if (historyIndex.current <= 0) return;
    historyIndex.current -= 1;
    skipTrackingRef.current = true;
    loadProject(history.current[historyIndex.current], null);
    setCanUndo(historyIndex.current > 0);
    setCanRedo(historyIndex.current < history.current.length - 1);
  }, [loadProject]);

  const redo = useCallback(() => {
    if (historyIndex.current >= history.current.length - 1) return;
    historyIndex.current += 1;
    skipTrackingRef.current = true;
    loadProject(history.current[historyIndex.current], null);
    setCanUndo(true);
    setCanRedo(historyIndex.current < history.current.length - 1);
  }, [loadProject]);

  // Keep stable refs for keyboard listener to avoid recreating it
  const undoRef = useRef(undo);
  const redoRef = useRef(redo);

  useEffect(() => {
    undoRef.current = undo;
    redoRef.current = redo;
  }, [undo, redo]);

  // Wire keyboard shortcuts (only set up once)
  useEffect(() => {
    const pressedKeys = new Set<string>();

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (pressedKeys.has(key)) return; // Already pressed, ignore repeat

      if ((e.ctrlKey || e.metaKey) && key === "z" && !e.shiftKey) {
        e.preventDefault();
        pressedKeys.add(key);
        undoRef.current();
      } else if ((e.ctrlKey || e.metaKey) && (key === "y" || (key === "z" && e.shiftKey))) {
        e.preventDefault();
        pressedKeys.add(key);
        redoRef.current();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      pressedKeys.delete(e.key.toLowerCase());
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  const pauseCapture = useCallback(() => {
    console.log('[useUndoRedo] pauseCapture called');
    isCapturingRef.current = false;

    // Auto-resume after 5 seconds as failsafe to prevent stuck paused state
    clearTimeout(captureTimeoutRef.current);
    captureTimeoutRef.current = setTimeout(() => {
      if (!isCapturingRef.current) {
        console.warn('[useUndoRedo] Auto-resuming capture after timeout (possible interrupted drag)');
        isCapturingRef.current = true;
      }
    }, 5000);
  }, []);

  const resumeCapture = useCallback(() => {
    console.log('[useUndoRedo] resumeCapture called');
    clearTimeout(captureTimeoutRef.current);
    isCapturingRef.current = true;

    // Force a history capture for the final state after drag/resize
    // We need to capture the current project state because the effect won't
    // re-run (project dependency hasn't changed since resuming)
    const currentProject = useEditor.getState().project;
    const current = history.current[historyIndex.current];

    // Only capture if the project has actually changed
    if (current !== currentProject && history.current.length > 0) {
      captureSnapshot(currentProject);
    }
  }, [captureSnapshot]);

  return { undo, redo, canUndo, canRedo, pauseCapture, resumeCapture, undoRef, redoRef };
}
