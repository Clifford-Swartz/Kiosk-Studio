import { useEffect, useRef, useState } from "react";
import { useEditor } from "./store.js";

/**
 * Menu dropdown button. Click shows menu with options.
 * Uses native <select> for simplicity (matches existing patterns).
 */
function MenuDropdown({
  label,
  options,
}: {
  label: string;
  options: { label: string; action: () => void; disabled?: boolean }[];
}) {
  return (
    <select
      value=""
      onChange={(e) => {
        const opt = options.find((o) => o.label === e.target.value);
        if (opt && !opt.disabled) {
          opt.action();
          e.target.value = "";
        }
      }}
      style={{
        ...btn,
        paddingRight: 20,
        cursor: "pointer",
      }}
    >
      <option value="">{label} ▾</option>
      {options.map((opt) => (
        <option key={opt.label} value={opt.label} disabled={opt.disabled}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

/**
 * Top ribbon (Composer-style): scene selector + add/rename/delete scene,
 * Save / Open, and the ▶ Play toggle that previews the project in the Player.
 *
 * Note: Electron disables window.prompt(), so renaming is done with an inline
 * input (double-click the scene name, or click Rename) — never a prompt dialog.
 */
export function TopBar({ onPlay, onKiosk, onSave, onOpen, onImportPptx, onUndo, onRedo, canUndo, canRedo }: {
  onPlay: () => void;
  onKiosk: () => void;
  onSave: () => void;
  onOpen: () => void;
  onImportPptx: () => void;
  onUndo: () => void;
  onRedo: () => void;
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
  const viewport = useEditor((s) => s.canvasViewport);
  const resetViewport = useEditor((s) => s.resetViewport);

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
      {/* Left: Title + Dropdowns */}
      <span style={{ fontWeight: 700, color: "#e2e8f0", marginRight: 12 }}>
        Kiosk Studio{dirty ? " •" : ""}
      </span>

      <MenuDropdown
        label="File"
        options={[
          { label: "Open…", action: onOpen },
          { label: "Save", action: onSave },
          { label: "Import PPTX…", action: onImportPptx },
        ]}
      />

      <MenuDropdown
        label="Scene"
        options={[
          { label: "Add Scene", action: addScene },
          { label: "Rename Scene", action: startRename },
          {
            label: "Delete Scene",
            action: () => active && removeScene(active.id),
            disabled: project.scenes.length <= 1,
          },
        ]}
      />

      <div style={{ flex: 1 }} />

      {/* Center: Scene Selector */}
      <span style={{ color: "#64748b", fontSize: 12, marginRight: 6 }}>Scene</span>
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

      <div style={{ flex: 1 }} />

      {/* Right: Icon Buttons */}
      <button
        style={{ ...iconBtn, ...playBtn }}
        onClick={onKiosk}
        title="Fullscreen kiosk mode (Ctrl+K, Esc to exit)"
      >
        ⛶
      </button>

      <button style={{ ...iconBtn, ...playBtn }} onClick={onPlay} title="Preview (Ctrl+P)">
        ▶
      </button>

      <button
        style={{ ...iconBtn, ...(canUndo ? {} : disabledIconBtn) }}
        onClick={() => onUndo()}
        disabled={!canUndo}
        title="Undo (Ctrl+Z)"
      >
        ↶
      </button>

      <button
        style={{ ...iconBtn, ...(canRedo ? {} : disabledIconBtn) }}
        onClick={() => onRedo()}
        disabled={!canRedo}
        title="Redo (Ctrl+Y)"
      >
        ↷
      </button>

      <button
        style={{ ...iconBtn, opacity: snapEnabled ? 1 : 0.4 }}
        onClick={toggleSnap}
        title={snapEnabled ? "Snap to guides: ON" : "Snap to guides: OFF"}
      >
        ⊞
      </button>

      <button
        style={{
          ...iconBtn,
          opacity: viewport.userZoom !== 1 || viewport.panX !== 0 || viewport.panY !== 0 ? 1 : 0.4
        }}
        onClick={resetViewport}
        title="Reset zoom to fit window (Ctrl+0)"
      >
        ⊡
      </button>
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
  background: "#1d2430",
  border: "1px solid #232c3a",
  borderRadius: 6,
  color: "#e2e8f0",
  fontSize: 13,
  padding: "6px 10px",
  cursor: "pointer",
};
const iconBtn: React.CSSProperties = {
  background: "#2c3647",
  border: "1px solid #232c3a",
  borderRadius: 6,
  color: "#e2e8f0",
  fontSize: 16,
  padding: "6px 12px",
  cursor: "pointer",
  minWidth: 40,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
const disabledIconBtn: React.CSSProperties = {
  opacity: 0.4,
  cursor: "not-allowed",
};
const playBtn: React.CSSProperties = {
  background: "#3b5da5",
  borderColor: "#1a274b",
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
