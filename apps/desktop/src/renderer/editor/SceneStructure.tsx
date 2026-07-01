import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useEditor } from "./store.js";

const TYPE_ICON: Record<string, string> = {
  rectangle: "▭",
  text: "T",
  image: "🖼",
  video: "▶",
  button: "⬭",
  layer: "◫",
};

/**
 * 16x16 SVG icon showing element type + visual properties.
 * Rectangle → tiny rect with actual fill color
 * Text → "T" with actual text color
 * Video → ▶ with color hint
 * Button → rounded rect with fill color
 * Others → type icon unchanged
 */
function SmartThumbnail({ element }: { element: { type: string; props: Record<string, unknown> } }) {
  const p = element.props;

  switch (element.type) {
    case "rectangle":
      const rectFill = typeof p.fill === "string" ? p.fill : "#3b82f6";
      return (
        <svg width="16" height="16" viewBox="0 0 16 16">
          <rect x="2" y="4" width="12" height="8" fill={rectFill} rx="2" />
        </svg>
      );

    case "text":
      const textColor = typeof p.color === "string" ? p.color : "#ffffff";
      return (
        <svg width="16" height="16" viewBox="0 0 16 16">
          <text x="8" y="12" fill={textColor} fontSize="12" fontWeight="bold" textAnchor="middle">T</text>
        </svg>
      );

    case "button":
      const btnFill = typeof p.fill === "string" ? p.fill : "#2563eb";
      return (
        <svg width="16" height="16" viewBox="0 0 16 16">
          <rect x="2" y="4" width="12" height="8" fill={btnFill} rx="3" />
        </svg>
      );

    case "video":
      return (
        <svg width="16" height="16" viewBox="0 0 16 16">
          <polygon points="6,4 6,12 12,8" fill="#94a3b8" />
        </svg>
      );

    case "layer":
      return (
        <svg width="16" height="16" viewBox="0 0 16 16">
          <rect x="2" y="2" width="12" height="12" fill="none" stroke="#64748b" strokeWidth="1.5" />
        </svg>
      );

    default:
      return <span style={{ fontSize: 14, opacity: 0.8 }}>{TYPE_ICON[element.type] ?? "•"}</span>;
  }
}

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
interface TreeNode {
  element: { id: string; type: string; name?: string; zIndex: number; opacity: number; props: Record<string, unknown>; locked?: boolean; children?: TreeNode['element'][] };
  depth: number;
  arrayIndex: number;
}

function buildTree(elements: TreeNode['element'][], collapsedIds: Set<string>, depth = 0): TreeNode[] {
  const nodes: TreeNode[] = [];
  // Iterate in reverse order to display top-most elements first
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    nodes.push({ element: el, depth, arrayIndex: i });
    // If element has children and is not collapsed, recurse
    if (el.children && !collapsedIds.has(el.id)) {
      const childNodes = buildTree(el.children, collapsedIds, depth + 1);
      nodes.push(...childNodes);
    }
  }
  return nodes;
}

export function SceneStructure() {
  const scene = useEditor((s) => s.activeScene());
  const selectedId = useEditor((s) => s.selectedId);
  const selectedIds = useEditor((s) => s.selectedIds);
  const selectElement = useEditor((s) => s.selectElement);
  const selectElements = useEditor((s) => s.selectElements);
  const addToSelection = useEditor((s) => s.addToSelection);
  const reorderElement = useEditor((s) => s.reorderElement);
  const reparentElement = useEditor((s) => s.reparentElement);
  const updateElement = useEditor((s) => s.updateElement);
  const collapsedElementIds = useEditor((s) => s.collapsedElementIds);
  const toggleElementCollapse = useEditor((s) => s.toggleElementCollapse);
  const createLayer = useEditor((s) => s.createLayer);

  // Build tree structure respecting collapse state
  // Display order: top-most (highest array index) first, like a layers panel.
  // This is now handled by iterating in reverse order within buildTree.
  const rows = buildTree(scene.elements, collapsedElementIds);

  // Drag state: the array index being dragged, and the array index hovered over.
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  // Reparenting mode: when hovering over middle of a layer row (not edge)
  const [reparentTargetId, setReparentTargetId] = useState<string | null>(null);

  // Click-and-hold drag detection
  const holdTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isDraggableRef = useRef(false);

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

  function handleDrop() {
    if (dragIdx === null) {
      setDragIdx(null);
      setOverIdx(null);
      setReparentTargetId(null);
      return;
    }

    const draggedNode = rows.find(n => n.arrayIndex === dragIdx);
    if (!draggedNode) {
      setDragIdx(null);
      setOverIdx(null);
      setReparentTargetId(null);
      return;
    }

    // Reparenting mode
    if (reparentTargetId) {
      const error = reparentElement(draggedNode.element.id, reparentTargetId);
      if (error) {
        alert(error); // Show validation error to user
      }
    }
    // Reordering mode
    else if (overIdx !== null && overIdx !== dragIdx) {
      reorderElement(draggedNode.element.id, overIdx);
    }

    setDragIdx(null);
    setOverIdx(null);
    setReparentTargetId(null);
  }

  return (
    <div style={panel}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={heading}>Scene Structure</div>
        <button
          onClick={createLayer}
          style={addLayerButton}
          title="Add Layer"
        >
          + Layer
        </button>
      </div>
      {rows.length === 0 && (
        <div style={{ color: "#64748b", fontSize: 12, padding: 4 }}>No elements yet.</div>
      )}
      {rows.map((node) => {
        const { element: el, depth, arrayIndex: i } = node;
        const isSel = el.id === selectedId || selectedIds.has(el.id);
        const isEditing = editingId === el.id;
        const canAcceptChildren = el.type === "layer" || el.type === "collection";
        const isReparentTarget = reparentTargetId === el.id;
        const isReorderTarget = overIdx === i && dragIdx !== null && dragIdx !== i && !reparentTargetId;
        const hasChildren = el.children && el.children.length > 0;
        const isCollapsed = collapsedElementIds.has(el.id);
        const isLayer = el.type === "layer";

        return (
          <div
            key={el.id}
            draggable={isDraggableRef.current && !isEditing && !el.locked}
            onDragStart={() => setDragIdx(i)}
            onDragEnd={() => {
              setDragIdx(null);
              setOverIdx(null);
              isDraggableRef.current = false;
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (dragIdx === null || dragIdx === i) return;

              const rect = e.currentTarget.getBoundingClientRect();
              const y = e.clientY - rect.top;
              const height = rect.height;

              // Top 25% or bottom 25% = reorder line
              // Middle 50% = reparent (only if element can accept children)
              if (canAcceptChildren && y > height * 0.25 && y < height * 0.75) {
                setReparentTargetId(el.id);
                setOverIdx(null);
              } else {
                setReparentTargetId(null);
                setOverIdx(i);
              }
            }}
            onDragLeave={() => {
              setReparentTargetId(null);
              setOverIdx(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              handleDrop();
            }}
            onMouseDown={(e) => {
              // Only start hold timer for left-click
              if (e.button !== 0) return;

              // Check if click is on or inside a button or input by walking up the DOM tree
              let target = e.target as HTMLElement;
              const row = e.currentTarget;
              while (target && target !== row) {
                if (target.tagName === "BUTTON" || target.tagName === "INPUT") return;
                target = target.parentElement as HTMLElement;
              }

              // Start a 200ms timer to enable dragging
              holdTimerRef.current = setTimeout(() => {
                isDraggableRef.current = true;
              }, 200);
            }}
            onMouseUp={() => {
              // Clear the hold timer if released early
              if (holdTimerRef.current) {
                clearTimeout(holdTimerRef.current);
                holdTimerRef.current = null;
              }
            }}
            onMouseLeave={() => {
              // Clear the hold timer if mouse leaves
              if (holdTimerRef.current) {
                clearTimeout(holdTimerRef.current);
                holdTimerRef.current = null;
              }
            }}
            onClick={(e) => {
              // Only handle click if we didn't start a drag
              if (isDraggableRef.current) {
                isDraggableRef.current = false;
                return;
              }

              // Block selection if element is locked
              if (el.locked) return;

              // Ctrl+click = add to selection
              if (e.ctrlKey || e.metaKey) {
                if (selectedIds.has(el.id)) {
                  const next = new Set(selectedIds);
                  next.delete(el.id);
                  selectElements(next);
                } else {
                  addToSelection([el.id]);
                }
              }
              // Click layer = select all direct children (if not locked)
              else if ((el.type === "layer" || el.type === "collection") && el.children && el.children.length > 0) {
                const childIds = new Set(el.children.filter(c => !c.locked).map(c => c.id));
                selectElements(childIds);
              }
              // Regular click = single select
              else {
                selectElement(el.id);
              }
            }}
            style={{
              ...row,
              ...(isLayer ? rowLayer : null),
              ...(isSel ? rowSelected : null),
              ...(isReorderTarget ? rowDropTarget : null),
              ...(isReparentTarget ? rowReparentTarget : null),
              opacity: dragIdx === i ? 0.4 : 1,
              paddingLeft: 2 + depth * 16,
              cursor: "pointer",
            }}
          >
            {hasChildren ? (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  toggleElementCollapse(el.id);
                }}
                style={{ width: 14, textAlign: "center", cursor: "pointer", fontSize: 10 }}
                title={isCollapsed ? "Expand" : "Collapse"}
              >
                {isCollapsed ? "▸" : "▾"}
              </span>
            ) : (
              <span style={{ width: 14 }} />
            )}
            <span style={{ width: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <SmartThumbnail element={el} />
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
            {isLayer && (
              <button
                title={el.locked ? "Unlock layer" : "Lock layer"}
                style={iconBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  updateElement(el.id, { locked: !el.locked });
                }}
              >
                {el.locked ? "🔒" : "🔓"}
              </button>
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
  borderTop: "4px solid #0a0e13",
  padding: "14px 12px",
  maxHeight: "230px",
  overflowY: "auto",
  background: "#13171d",
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
  gap: 3,
  padding: "5px 5px",
  marginBottom: 1,
  borderRadius: 6,
  border: "1px solid #4e546694",
  background: "#0f131b",
  color: "#cbd5e1",
  fontSize: 13,
  cursor: "pointer",
};
const rowSelected: CSSProperties = {
  background: "#1e3a52",
  color: "#e0f2fe",
};
const rowLayer: CSSProperties = {
  background: "#12161f",
};
const rowDropTarget: CSSProperties = {
  // A line on top indicates where the dragged row will land (reorder mode).
  boxShadow: "inset 0 2px 0 0 #38bdf8",
};
const rowReparentTarget: CSSProperties = {
  // Full-row highlight indicates element will be reparented into this container.
  background: "#1e3a52",
  border: "1px solid #38bdf8",
  boxShadow: "0 0 0 2px rgba(56, 189, 248, 0.2)",
};
const addLayerButton: CSSProperties = {
  background: "#1e293b",
  border: "1px solid #334155",
  borderRadius: 4,
  color: "#cbd5e1",
  fontSize: 11,
  padding: "3px 8px",
  cursor: "pointer",
  fontWeight: 500,
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
