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
export function TopBar({ onPlay, onKiosk, onSave, onSaveAs, onOpen, onImportPptx, onUndo, onRedo, canUndo, canRedo }: {
  onPlay: () => void;
  onKiosk: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onOpen: () => void;
  onImportPptx: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}) {

  const dirty = useEditor((s) => s.dirty);
  const snapEnabled = useEditor((s) => s.snapEnabled);
  const toggleSnap = useEditor((s) => s.toggleSnap);
  const viewport = useEditor((s) => s.canvasViewport);
  const resetViewport = useEditor((s) => s.resetViewport);

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
          { label: "Save As…", action: onSaveAs },
          { label: "Import PPTX…", action: onImportPptx },
        ]}
      />

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
