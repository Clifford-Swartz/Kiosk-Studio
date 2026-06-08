import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useEditor } from "./store.js";

const TYPE_ICON: Record<string, string> = {
  rectangle: "▭",
  text: "T",
  image: "🖼",
  video: "▶",
  button: "⬭",
  group: "▦",
};

/**
 * Layer tree (Composer's "Scene Structure"). Lists the active scene's elements
 * top-to-bottom in draw order (topmost zIndex first). Behaviors:
 *  - click selects (synced to canvas + Properties)
 *  - double-click the label renames the element (sets its `name`)
 *  - drag a row to reorder draw order; ▲▼ also nudge one step
 *  - the eye toggles visibility
 *
 * Note: rows render reversed (topmost first) but reorderElement works in array
 * order (index = draw order, low = back), so we convert between the two.
 */
export function SceneStructure() {
  const scene = useEditor((s) => s.activeScene());
  const selectedId = useEditor((s) => s.selectedId);
  const selectElement = useEditor((s) => s.selectElement);
  const reorderElement = useEditor((s) => s.reorderElement);
  const updateElement = useEditor((s) => s.updateElement);

  // Display order: top-most (highest array index) first, like a layers panel.
  const rows = scene.elements.map((el, i) => ({ el, i })).reverse();

  // Drag state: the array index being dragged, and the array index hovered over.
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  // Inline rename state.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editingId) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editingId]);

  function startRename(el: { id: string; name?: string; type: string }) {
    setDraft(el.name ?? el.type);
    setEditingId(el.id);
  }
  function commitRename(id: string, value: string) {
    const name = value.trim();
    updateElement(id, { name: name || undefined });
    setEditingId(null);
  }

  function handleDrop(targetArrayIdx: number) {
    if (dragIdx === null || dragIdx === targetArrayIdx) {
      setDragIdx(null);
      setOverIdx(null);
      return;
    }
    const id = scene.elements[dragIdx]?.id;
    if (id) reorderElement(id, targetArrayIdx);
    setDragIdx(null);
    setOverIdx(null);
  }

  return (
    <div style={panel}>
      <div style={heading}>Scene Structure</div>
      {rows.length === 0 && (
        <div style={{ color: "#64748b", fontSize: 12, padding: 4 }}>No elements yet.</div>
      )}
      {rows.map(({ el, i }) => {
        const isSel = el.id === selectedId;
        const isEditing = editingId === el.id;
        const isOver = overIdx === i && dragIdx !== null && dragIdx !== i;
        return (
          <div
            key={el.id}
            // Drop targeting is on the row; dragging is initiated only by the
            // handle (below), so the label stays free to receive double-clicks
            // (a draggable parent suppresses dblclick on its children).
            onDragOver={(e) => {
              e.preventDefault();
              setOverIdx(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              handleDrop(i);
            }}
            onClick={() => selectElement(el.id)}
            style={{
              ...row,
              ...(isSel ? rowSelected : null),
              ...(isOver ? rowDropTarget : null),
              opacity: dragIdx === i ? 0.4 : 1,
            }}
          >
            <span
              draggable={!isEditing}
              onDragStart={() => setDragIdx(i)}
              onDragEnd={() => {
                setDragIdx(null);
                setOverIdx(null);
              }}
              title="Drag to reorder"
              style={{ width: 14, textAlign: "center", color: "#475569", cursor: "grab" }}
            >
              ⠿
            </span>
            <span style={{ width: 18, textAlign: "center", opacity: 0.8 }}>
              {TYPE_ICON[el.type] ?? "•"}
            </span>
            {isEditing ? (
              <input
                ref={inputRef}
                data-testid="layer-rename"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => commitRename(el.id, e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename(el.id, e.currentTarget.value);
                  if (e.key === "Escape") setEditingId(null);
                }}
                style={renameInput}
              />
            ) : (
              <span
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startRename(el);
                }}
                title="Double-click to rename layer"
                data-testid="layer-label"
                style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {el.name || el.type}
              </span>
            )}
            <button
              title="Toggle visibility"
              style={iconBtn}
              onClick={(e) => {
                e.stopPropagation();
                updateElement(el.id, { opacity: el.opacity === 0 ? 1 : 0 });
              }}
            >
              {el.opacity === 0 ? "🚫" : "👁"}
            </button>
            <button
              title="Bring forward"
              style={iconBtn}
              onClick={(e) => {
                e.stopPropagation();
                reorderElement(el.id, i + 1);
              }}
            >
              ▲
            </button>
            <button
              title="Send backward"
              style={iconBtn}
              onClick={(e) => {
                e.stopPropagation();
                reorderElement(el.id, i - 1);
              }}
            >
              ▼
            </button>
          </div>
        );
      })}
    </div>
  );
}

const panel: CSSProperties = {
  borderTop: "4px solid #0b1016",
  padding: "14px 12px",
  maxHeight: "38%",
  overflowY: "auto",
};
const heading: CSSProperties = {
  color: "#7c8aa0",
  fontSize: 10.5,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 0.8,
  margin: "0 2px 10px",
};
const row: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 6px",
  marginBottom: 2,
  borderRadius: 6,
  background: "#11161f",
  color: "#cbd5e1",
  fontSize: 13,
  cursor: "pointer",
};
const rowSelected: CSSProperties = {
  background: "#1e3a52",
  color: "#e0f2fe",
};
const rowDropTarget: CSSProperties = {
  // A line on top indicates where the dragged row will land.
  boxShadow: "inset 0 2px 0 0 #38bdf8",
};
const iconBtn: CSSProperties = {
  background: "none",
  border: "none",
  color: "inherit",
  cursor: "pointer",
  fontSize: 11,
  padding: "0 2px",
  opacity: 0.7,
};
const renameInput: CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: "#0b1016",
  border: "1px solid #38bdf8",
  borderRadius: 4,
  color: "#e2e8f0",
  fontSize: 13,
  padding: "2px 6px",
};
