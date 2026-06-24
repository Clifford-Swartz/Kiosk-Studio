import React, { useState, useMemo, useEffect, useRef, type CSSProperties } from "react";
import { useEditor } from "./store";
import { buildSceneHierarchy, type SceneNode } from "./sceneHierarchy";

// Styles defined before component
const panel: CSSProperties = {
  padding: "14px 12px",
  overflowY: "auto",
  flex: 1,
};

const navSection: CSSProperties = {
  marginBottom: 16,
  paddingBottom: 12,
  borderBottom: "2px solid #1e293b",
};

const sectionHeader: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  color: "#64748b",
  marginBottom: 8,
  letterSpacing: "0.5px",
};

const checkboxLabel: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 13,
  color: "#cbd5e1",
  cursor: "pointer",
  padding: "4px 0",
};

const checkbox: CSSProperties = {
  cursor: "pointer",
  accentColor: "#38bdf8",
};

const row: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 6px",
  marginBottom: 2,
  borderRadius: 6,
  background: "#141a24",
  color: "#cbd5e1",
  fontSize: 13,
  cursor: "pointer",
};

const rowActive: CSSProperties = {
  background: "#1d2633",
  color: "#e0f2fe",
};

const chevron: CSSProperties = {
  cursor: "pointer",
  fontSize: 16,
  width: 12,
  textAlign: "center",
  color: "#5e6fa7",
};

const treeLines: CSSProperties = {
  fontFamily: "monospace",
  fontSize: 12,
  color: "#475569",
  whiteSpace: "pre",
  lineHeight: 1,
};

const hoverActions: CSSProperties = {
  display: "flex",
  gap: 4,
  opacity: 0.7,
};

const iconBtn: CSSProperties = {
  background: "none",
  border: "none",
  color: "inherit",
  cursor: "pointer",
  fontSize: 11,
  padding: "0 2px",
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

/**
 * Project hierarchy tab: renders scene tree with auto-detected topology.
 */
export function ProjectHierarchy() {
  const project = useEditor((s) => s.project);
  const visualParents = useEditor((s) => s.visualParents);
  const activeSceneId = useEditor((s) => s.activeSceneId);
  const collapsedScenes = useEditor((s) => s.collapsedScenes);

  const setActiveScene = useEditor((s) => s.setActiveScene);
  const toggleSceneCollapse = useEditor((s) => s.toggleSceneCollapse);
  const addChildScene = useEditor((s) => s.addChildScene);
  const renameScene = useEditor((s) => s.renameScene);
  const removeScene = useEditor((s) => s.removeScene);
  const setEnableBackButton = useEditor((s) => s.setEnableBackButton);
  const setEnableHomeButton = useEditor((s) => s.setEnableHomeButton);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const hierarchy = useMemo(
    () => buildSceneHierarchy(project, visualParents),
    [project.scenes, project.startSceneId, visualParents]
  );

  // Focus input when entering edit mode
  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  // Commit on unmount (tab switch during edit)
  useEffect(() => {
    return () => {
      if (editingId && draft.trim()) {
        renameScene(editingId, draft.trim());
      }
    };
  }, [editingId, draft, renameScene]);

  function startRename(node: SceneNode) {
    setEditingId(node.sceneId);
    setDraft(node.name);
  }

  function commitRename() {
    if (editingId && draft.trim()) {
      renameScene(editingId, draft.trim());
    }
    setEditingId(null);
  }

  function cancelRename() {
    setEditingId(null);
  }

  function handleRowClick(sceneId: string) {
    if (editingId !== sceneId) {
      setActiveScene(sceneId);
    }
  }

  function getStatusColor(node: SceneNode): string {
    if (node.isHome) return "#425eda"; // blue-400
    if (node.parentCount === 0) return "#d14444"; // red-400 (orphan)
    if (node.parentCount >= 2) return "#20ce8e"; // green-400 (multi-parent)
    return "#cbd5e1"; // default gray
  }

  function renderNode(
    node: SceneNode,
    depth: number,
    isLast: boolean,
    parentLines: boolean[]
  ): React.ReactNode {
    const isCollapsed = collapsedScenes.has(node.sceneId);
    const isActive = node.sceneId === activeSceneId;
    const isEditing = editingId === node.sceneId;
    const hasChildren = node.children.length > 0;

    return (
      <div key={node.sceneId}>
        {/* Scene row */}
        <div
          style={{
            ...row,
            ...(isActive && !isEditing ? rowActive : null),
            paddingLeft: 6,
          }}
          onClick={() => handleRowClick(node.sceneId)}
        >
          {/* Tree connectors */}
          {depth > 0 && (
            <span style={treeLines}>
              {parentLines.map((needsLine, i) => (
                <span key={i} style={{ width: 16, display: "inline-block" }}>
                  {needsLine ? "│ " : "  "}
                </span>
              ))}
              <span style={{ width: 16, display: "inline-block" }}>
                {isLast ? "└─" : "├─"}
              </span>
            </span>
          )}

          {/* Chevron (only if has children) */}
          {hasChildren && (
            <span
              style={chevron}
              onClick={(e) => {
                e.stopPropagation();
                toggleSceneCollapse(node.sceneId);
              }}
            >
              {isCollapsed ? "▸" : "▾"}
            </span>
          )}

          {/* Spacer if no chevron */}
          {!hasChildren && <div style={{ width: 14 }} />}

          {/* Scene name + count */}
          {isEditing ? (
            <input
              ref={inputRef}
              style={renameInput}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") cancelRename();
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span style={{ flex: 1, minWidth: 0, color: getStatusColor(node) }}>
              {node.name}{" "}
              <span style={{ color: "#94a3b8" }}>({node.elementCount})</span>
            </span>
          )}

          {/* Hover actions */}
          {!isEditing && (
            <div style={hoverActions}>
              <button
                style={iconBtn}
                title="Add child scene"
                onClick={(e) => {
                  e.stopPropagation();
                  addChildScene(node.sceneId);
                }}
              >
                +
              </button>
              <button
                style={iconBtn}
                title="Rename"
                onClick={(e) => {
                  e.stopPropagation();
                  startRename(node);
                }}
              >
                ✏
              </button>
              <button
                style={iconBtn}
                title="Delete"
                onClick={(e) => {
                  e.stopPropagation();
                  removeScene(node.sceneId);
                }}
              >
                🗑
              </button>
            </div>
          )}
        </div>

        {/* Nested children (if expanded) */}
        {!isCollapsed &&
          node.children.map((child, idx) => {
            const childIsLast = idx === node.children.length - 1;
            const newParentLines = [...parentLines, !isLast];
            return renderNode(child, depth + 1, childIsLast, newParentLines);
          })}
      </div>
    );
  }

  return (
    <div style={panel}>
      {/* Navigation settings section */}
      <div style={navSection}>
        <div style={sectionHeader}>Navigation</div>
        <label style={checkboxLabel}>
          <input
            type="checkbox"
            checked={project.enableBackButton ?? false}
            onChange={(e) => setEnableBackButton(e.target.checked)}
            style={checkbox}
          />
          <span>Enable Back Button</span>
        </label>
        <label style={checkboxLabel}>
          <input
            type="checkbox"
            checked={project.enableHomeButton ?? false}
            onChange={(e) => setEnableHomeButton(e.target.checked)}
            style={checkbox}
          />
          <span>Enable Home Button</span>
        </label>
      </div>

      {/* Scene hierarchy */}
      <div style={sectionHeader}>Scenes</div>
      {hierarchy.map((node, idx) =>
        renderNode(node, 0, idx === hierarchy.length - 1, [])
      )}
    </div>
  );
}
