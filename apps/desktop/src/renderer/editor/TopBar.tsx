import { useEffect, useRef, useState } from "react";
import { useEditor } from "./store.js";

/**
 * Top ribbon (Composer-style): scene selector + add/rename/delete scene,
 * Save / Open, and the ▶ Play toggle that previews the project in the Player.
 *
 * Note: Electron disables window.prompt(), so renaming is done with an inline
 * input (double-click the scene name, or click Rename) — never a prompt dialog.
 */
export function TopBar({ onPlay, onKiosk, onSave, onOpen, onImportPptx, undoRef, redoRef, canUndo, canRedo }: {
  onPlay: () => void;
  onKiosk: () => void;
  onSave: () => void;
  onOpen: () => void;
  onImportPptx: () => void;
  undoRef: React.MutableRefObject<() => void>;
  redoRef: React.MutableRefObject<() => void>;
  canUndo: boolean;
  canRedo: boolean;
}) {

  const project = useEditor((s) => s.project);
  const activeSceneId = useEditor((s) => s.activeSceneId);
  const dirty = useEditor((s) => s.dirty);
  const setActiveScene = useEditor((s) => s.setActiveScene);
  const addScene = useEditor((s) => s.addScene);
  const renameScene = useEditor((s) => s.renameScene);
  const removeScene = useEditor((s) => s.removeScene);
  const snapEnabled = useEditor((s) => s.snapEnabled);
  const toggleSnap = useEditor((s) => s.toggleSnap);

  const active = project.scenes.find((s) => s.id === activeSceneId);

  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function startRename() {
    if (!active) return;
    setDraft(active.name);
    setRenaming(true);
  }
  function commitRename() {
    if (active && draft.trim()) renameScene(active.id, draft.trim());
    setRenaming(false);
  }

  useEffect(() => {
    if (renaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [renaming]);

  return (
    <div style={bar}>
      <span style={{ fontWeight: 700, color: "#e2e8f0", marginRight: 8 }}>
        Kiosk Studio{dirty ? " •" : ""}
      </span>

      <span style={{ color: "#64748b", fontSize: 12 }}>Scene</span>
      {renaming ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") setRenaming(false);
          }}
          style={select}
        />
      ) : (
        <select
          value={activeSceneId}
          onChange={(e) => setActiveScene(e.target.value)}
          onDoubleClick={startRename}
          title="Double-click to rename"
          style={select}
        >
          {project.scenes.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}

      <button style={btn} onClick={addScene} title="Add scene">＋ Scene</button>
      <button style={btn} onClick={startRename}>
        Rename
      </button>
      <button
        style={btn}
        disabled={project.scenes.length <= 1}
        onClick={() => active && removeScene(active.id)}
      >
        Delete scene
      </button>

      <div style={{ flex: 1 }} />

      <button
        style={{ ...btn, ...(snapEnabled ? toggleOn : null) }}
        onClick={toggleSnap}
        title="Snap to alignment guides (hold Alt while dragging to override)"
      >
        Snap: {snapEnabled ? "On" : "Off"}
      </button>
      <button
        style={{ ...btn, ...(canUndo ? {} : disabledBtn) }}
        onClick={() => undoRef.current()}
        disabled={!canUndo}
        title="Undo (Ctrl+Z)"
      >
        ↶ Undo
      </button>
      <button
        style={{ ...btn, ...(canRedo ? {} : disabledBtn) }}
        onClick={() => redoRef.current()}
        disabled={!canRedo}
        title="Redo (Ctrl+Y)"
      >
        ↷ Redo
      </button>
      <button style={btn} onClick={onOpen}>Open…</button>
      <button style={btn} onClick={onImportPptx} title="Import a PowerPoint as scenes">Import PPTX…</button>
      <button style={btn} onClick={onSave}>Save</button>
      <button style={btn} onClick={onKiosk} title="Fullscreen kiosk mode (Esc to exit)">⛶ Kiosk</button>
      <button style={{ ...btn, ...playBtn }} onClick={onPlay}>▶ Play</button>
    </div>
  );
}

const bar: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 12px",
  background: "linear-gradient(90deg, #0b1016, #131a24)",
  borderBottom: "1px solid #1f2733",
  flexShrink: 0,
};
const btn: React.CSSProperties = {
  background: "#161c26",
  border: "1px solid #232c3a",
  borderRadius: 6,
  color: "#e2e8f0",
  fontSize: 13,
  padding: "6px 10px",
  cursor: "pointer",
};
const toggleOn: React.CSSProperties = {
  background: "#1e3a52",
  borderColor: "#38bdf8",
  color: "#e0f2fe",
};
const playBtn: React.CSSProperties = {
  background: "#2563eb",
  borderColor: "#1d4ed8",
  color: "#fff",
  fontWeight: 600,
};
const select: React.CSSProperties = {
  background: "#161c26",
  border: "1px solid #232c3a",
  borderRadius: 6,
  color: "#e2e8f0",
  fontSize: 13,
  padding: "6px 8px",
  minWidth: 140,
};
const disabledBtn: React.CSSProperties = {
  opacity: 0.5,
  cursor: "not-allowed",
};
