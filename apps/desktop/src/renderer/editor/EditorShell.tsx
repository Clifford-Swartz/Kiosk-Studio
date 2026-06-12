import { Canvas } from "./Canvas.js";
import { DataSourcesPanel } from "./DataSourcesPanel.js";
import { Palette } from "./Palette.js";
import { PropertiesPanel } from "./PropertiesPanel.js";
import { SceneStructure } from "./SceneStructure.js";
import { TopBar } from "./TopBar.js";
import { useUndoRedo } from "./useUndoRedo.js";

/**
 * Composer-style editor layout:
 *   ┌───────────── TopBar (scenes, save, ▶ Play) ─────────────┐
 *   │ Palette │            Canvas               │ Properties   │
 *   │         │                                 │              │
 *   │ Scene   │                                 │              │
 *   │ Struct. │                                 │              │
 *   └─────────┴─────────────────────────────────┴──────────────┘
 */
export function EditorShell({ onPlay, onKiosk, onSave, onOpen, onImportPptx }: {
  onPlay: () => void;
  onKiosk: () => void;
  onSave: () => void;
  onOpen: () => void;
  onImportPptx: () => void;
}) {
  const { pauseCapture, resumeCapture, undoRef, redoRef, canUndo, canRedo } = useUndoRedo();

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", background: "#0b1016" }}>
      <TopBar onPlay={onPlay} onKiosk={onKiosk} onSave={onSave} onOpen={onOpen} onImportPptx={onImportPptx} undoRef={undoRef} redoRef={redoRef} canUndo={canUndo} canRedo={canRedo} />
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <div style={{ width: 220, flexShrink: 0, display: "flex", flexDirection: "column", minHeight: 0, overflowY: "auto", background: "#0e1218", borderRight: "1px solid #1f2733" }}>
          <Palette />
          <SceneStructure />
          <DataSourcesPanel />
        </div>
        <Canvas pauseCapture={pauseCapture} resumeCapture={resumeCapture} />
        <PropertiesPanel />
      </div>
    </div>
  );
}
