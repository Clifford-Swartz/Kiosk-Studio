import { Canvas } from "./Canvas.js";
import { PropertiesPanel } from "./PropertiesPanel.js";
import { SidebarTabs } from "./SidebarTabs.js";
import { TopBar } from "./TopBar.js";
import { useUndoRedo } from "./useUndoRedo.js";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts.js";
import { useEditor } from "./store.js";

/**
 * Composer-style editor layout:
 *   ┌───────────── TopBar (scenes, save, ▶ Play) ─────────────┐
 *   │ Palette │            Canvas               │ Properties   │
 *   │         │                                 │              │
 *   │ Scene   │                                 │              │
 *   │ Struct. │                                 │              │
 *   └─────────┴─────────────────────────────────┴──────────────┘
 */
export function EditorShell({ onPlay, onKiosk, onSave, onSaveAs, onOpen, onImportPptx }: {
  onPlay: () => void;
  onKiosk: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onOpen: () => void;
  onImportPptx: () => void;
}) {
  const { undo, redo, pauseCapture, resumeCapture, canUndo, canRedo } = useUndoRedo();

  const selectedId = useEditor((s) => s.selectedId);
  const removeElement = useEditor((s) => s.removeElement);
  const copyElement = useEditor((s) => s.copyElement);
  const cutElement = useEditor((s) => s.cutElement);
  const pasteElement = useEditor((s) => s.pasteElement);
  const resetViewport = useEditor((s) => s.resetViewport);

  // Register keyboard shortcuts for editor actions. Undo/redo go through the
  // same hook (ADR 0003) so their listeners track the latest callbacks — no
  // stale-ref bug from a hand-rolled listener.
  useKeyboardShortcuts({
    "Mod+Z": {
      action: () => undo(),
      enabled: () => canUndo,
      description: "Undo",
      preventDefault: true,
      log: true,
    },
    "Mod+Shift+Z": {
      action: () => redo(),
      enabled: () => canRedo,
      description: "Redo",
      preventDefault: true,
      log: true,
    },
    "Mod+Y": {
      action: () => redo(),
      enabled: () => canRedo,
      description: "Redo (alt)",
      preventDefault: true,
      log: true,
    },
    "Mod+P": {
      action: () => onPlay(),
      description: "Preview mode",
      preventDefault: true,
      log: true,
    },
    "Mod+K": {
      action: () => onKiosk(),
      description: "Kiosk mode",
      preventDefault: true,
      log: true,
    },
    "Mod+S": {
      action: () => onSave(),
      description: "Save project",
      preventDefault: true,
      log: true,
    },
    "Mod+Shift+S": {
      action: () => onSaveAs(),
      description: "Save project as",
      preventDefault: true,
      log: true,
    },
    "Mod+C": {
      action: () => copyElement(),
      enabled: () => !!selectedId,
      description: "Copy selected element",
      preventDefault: true,
      log: true,
    },
    "Mod+X": {
      action: () => cutElement(),
      enabled: () => !!selectedId,
      description: "Cut selected element",
      preventDefault: true,
      log: true,
    },
    "Mod+V": {
      action: () => pasteElement(),
      description: "Paste element from clipboard",
      preventDefault: true,
      log: true,
    },
    "Delete": {
      action: () => {
        if (selectedId) removeElement(selectedId);
      },
      enabled: () => !!selectedId,
      description: "Delete selected element",
      preventDefault: true,
      log: true,
    },
    "Backspace": {
      action: () => {
        if (selectedId) removeElement(selectedId);
      },
      enabled: () => !!selectedId,
      description: "Delete selected element",
      preventDefault: true,
      log: true,
    },
    "Mod+0": {
      action: () => resetViewport(),
      description: "Reset zoom to fit window",
      preventDefault: true,
      log: true,
    },
  });

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", background: "#0b1016" }}>
      <TopBar onPlay={onPlay} onKiosk={onKiosk} onSave={onSave} onSaveAs={onSaveAs} onOpen={onOpen} onImportPptx={onImportPptx} onUndo={undo} onRedo={redo} canUndo={canUndo} canRedo={canRedo} />
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <SidebarTabs />
        <Canvas pauseCapture={pauseCapture} resumeCapture={resumeCapture} />
        <PropertiesPanel />
      </div>
    </div>
  );
}
