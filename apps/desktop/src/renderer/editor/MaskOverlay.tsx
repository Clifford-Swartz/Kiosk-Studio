import React, { useState, useRef, useEffect } from "react";
import type { LayerMask, Element } from "@kiosk/engine";
import { useEditor } from "./store.js";

type Tool = "rect" | "polygon";
type Point = [number, number];

interface MaskOverlayProps {
  element: Element;
  scale: number;
  pauseCapture: () => void;
  resumeCapture: () => void;
}

/**
 * On-canvas mask editor overlay. Renders directly on the stage at the element's
 * position, allowing users to draw masks in context with the actual scene.
 */
export function MaskOverlay({ element, scale, pauseCapture, resumeCapture }: MaskOverlayProps) {
  const updateElement = useEditor((s) => s.updateElement);
  const exitMaskEditing = useEditor((s) => s.exitMaskEditing);

  const [tool, setTool] = useState<Tool>("rect");
  const [mask, setMask] = useState<LayerMask | null>(element.mask ?? null);
  const [tempPoints, setTempPoints] = useState<Point[]>([]);
  const [editingPointIndex, setEditingPointIndex] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const stateRef = useRef({ tool, mask, tempPoints, editingPointIndex, isDragging });
  stateRef.current = { tool, mask, tempPoints, editingPointIndex, isDragging };

  // Pause undo capture on mount, resume on unmount
  useEffect(() => {
    pauseCapture();
    return () => resumeCapture();
  }, [pauseCapture, resumeCapture]);

  // Guard: masks only valid on layers (after hooks to avoid Rules of Hooks violation)
  if (element.type !== "layer") {
    console.warn(`MaskOverlay invoked on non-layer element (${element.type}). Masks are layer-exclusive.`);
    return null;
  }

  // Convert client coords to scene-absolute coords.
  // Works because layers are always fullscreen at (0,0), so element-local = scene-absolute.
  const getScenePoint = (e: React.MouseEvent<HTMLDivElement>): Point => {
    const target = e.currentTarget;
    const rect = target.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * element.width;
    const y = ((e.clientY - rect.top) / rect.height) * element.height;
    return [Math.round(x), Math.round(y)];
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const point = getScenePoint(e);

    // Check if clicking on existing control point
    const activeMask = mask ?? (tempPoints.length > 0 ? { type: tool, points: tempPoints } as LayerMask : null);
    if (activeMask) {
      const clickedIndex = activeMask.points.findIndex(([x, y]) => {
        const dx = point[0] - x;
        const dy = point[1] - y;
        return Math.sqrt(dx * dx + dy * dy) < 10 / scaleRef.current;
      });
      if (clickedIndex !== -1) {
        setEditingPointIndex(clickedIndex);
        setIsDragging(true);
        return;
      }
    }

    // Start new shape
    if (tool === "rect") {
      setTempPoints([point]);
      setIsDragging(true);
    } else if (tool === "polygon") {
      setTempPoints([...tempPoints, point]);
    }
  };

  const onPointerMove = useRef((e: PointerEvent) => {
    const state = stateRef.current;
    if (!state.isDragging) return;
    const target = document.querySelector(`[data-mask-overlay="${element.id}"]`) as HTMLElement;
    if (!target) return;

    const rect = target.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * element.width;
    const y = ((e.clientY - rect.top) / rect.height) * element.height;
    const point: Point = [Math.round(x), Math.round(y)];

    if (state.editingPointIndex !== null) {
      // Drag existing point
      const activeMask = state.mask ?? { type: state.tool, points: state.tempPoints };
      const newPoints = [...activeMask.points];
      newPoints[state.editingPointIndex] = point;
      if (state.mask) {
        setMask({ ...state.mask, points: newPoints });
      } else {
        setTempPoints(newPoints);
      }
    } else if (state.tool === "rect" && state.tempPoints.length === 1) {
      // Drag rect second corner
      setTempPoints([state.tempPoints[0], point]);
    }
  }).current;

  const onPointerUp = useRef(() => {
    const state = stateRef.current;
    setIsDragging(false);
    if (state.tool === "rect" && state.tempPoints.length === 2) {
      setMask({ type: "rect", points: state.tempPoints });
      setTempPoints([]);
    }
    setEditingPointIndex(null);
  }).current;

  useEffect(() => {
    if (isDragging) {
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      return () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
      };
    }
  }, [isDragging, onPointerMove, onPointerUp]);

  const handleDoubleClick = () => {
    if (tool === "polygon" && tempPoints.length >= 3) {
      setMask({ type: "polygon", points: tempPoints });
      setTempPoints([]);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && tool === "polygon" && tempPoints.length >= 3) {
      setMask({ type: "polygon", points: tempPoints });
      setTempPoints([]);
    } else if (e.key === "Escape") {
      exitMaskEditing();
    } else if (e.key === "Backspace" && tempPoints.length > 0) {
      e.preventDefault();
      setTempPoints(tempPoints.slice(0, -1));
    }
  };

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [tool, tempPoints]);

  const handleSave = () => {
    exitMaskEditing(); // Clear modal state first so updateElement not blocked
    if (mask) {
      updateElement(element.id, { mask });
    }
    resumeCapture(); // Capture snapshot with mask change
  };

  const handleCancel = () => {
    exitMaskEditing();
    resumeCapture(); // No snapshot (no changes committed)
  };

  const handleDeleteMask = () => {
    updateElement(element.id, { mask: undefined });
    exitMaskEditing();
  };

  const activeMask = mask ?? (tempPoints.length > 0 ? { type: tool, points: tempPoints } as LayerMask : null);
  const isDoneDisabled = mask === null && tempPoints.length === 0;

  return (
    <>
      {/* Floating toolbar */}
      <div
        style={{
          position: "fixed",
          top: 80,
          right: 20,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          padding: 12,
          background: "#0e1218",
          border: "1px solid #1f2733",
          borderRadius: 8,
          zIndex: 1000000,
          boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
          pointerEvents: "auto",
        }}
      >
        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Mask Tool</div>
        <button
          style={{
            ...toolBtn,
            background: tool === "rect" ? "#2563eb" : "#161c26",
            color: tool === "rect" ? "#fff" : "#e2e8f0",
          }}
          onClick={() => {
            setTool("rect");
            setTempPoints([]);
          }}
        >
          Rectangle
        </button>
        <button
          style={{
            ...toolBtn,
            background: tool === "polygon" ? "#2563eb" : "#161c26",
            color: tool === "polygon" ? "#fff" : "#e2e8f0",
          }}
          onClick={() => {
            setTool("polygon");
            setTempPoints([]);
          }}
        >
          Polygon
        </button>
        <div style={{ height: 1, background: "#232c3a", margin: "4px 0" }} />
        <button style={{ ...toolBtn, color: "#fca5a5" }} onClick={handleDeleteMask}>
          Delete Mask
        </button>
        <button style={toolBtn} onClick={handleCancel}>
          Cancel
        </button>
        <button
          style={{
            ...toolBtn,
            background: isDoneDisabled ? "#232c3a" : "#2563eb",
            color: isDoneDisabled ? "#64748b" : "#fff",
            cursor: isDoneDisabled ? "not-allowed" : "pointer",
          }}
          onClick={handleSave}
          disabled={isDoneDisabled}
        >
          Done
        </button>
      </div>

      {/* Mask editing overlay on canvas */}
      <div
        data-mask-overlay={element.id}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: element.width,
          height: element.height,
          transform: `translate(${element.x}px, ${element.y}px) rotate(${element.rotation}deg)`,
          transformOrigin: "center center",
          cursor: "crosshair",
          zIndex: 999999,
          pointerEvents: "auto",
        }}
      >
        {/* Semi-transparent background to show element bounds */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(59, 130, 246, 0.1)",
            border: `${2 / scale}px solid #3b82f6`,
            pointerEvents: "none",
          }}
        />

        {/* Draw mask shape */}
        {activeMask && (
          <svg
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
            }}
            width={element.width}
            height={element.height}
          >
            {activeMask.type === "rect" && activeMask.points.length === 2 && (() => {
              const x1 = activeMask.points[0][0];
              const y1 = activeMask.points[0][1];
              const x2 = activeMask.points[1][0];
              const y2 = activeMask.points[1][1];
              const x = Math.min(x1, x2);
              const y = Math.min(y1, y2);
              const width = Math.abs(x2 - x1);
              const height = Math.abs(y2 - y1);
              return (
                <rect
                  x={x}
                  y={y}
                  width={width}
                  height={height}
                  fill="rgba(59, 130, 246, 0.3)"
                  stroke="#3b82f6"
                  strokeWidth={2 / scale}
                />
              );
            })()}
            {activeMask.type === "polygon" && activeMask.points.length > 0 && (
              <polygon
                points={activeMask.points.map(([x, y]) => `${x},${y}`).join(" ")}
                fill="rgba(59, 130, 246, 0.3)"
                stroke="#3b82f6"
                strokeWidth={2 / scale}
              />
            )}
            {/* Control points */}
            {activeMask.points.map(([x, y], i) => (
              <circle
                key={i}
                cx={x}
                cy={y}
                r={6 / scale}
                fill={editingPointIndex === i ? "#f59e0b" : "#3b82f6"}
                stroke="#0b1016"
                strokeWidth={2 / scale}
              />
            ))}
          </svg>
        )}
      </div>
    </>
  );
}

const toolBtn: React.CSSProperties = {
  padding: "8px 16px",
  background: "#161c26",
  border: "1px solid #232c3a",
  borderRadius: 6,
  color: "#e2e8f0",
  fontSize: 13,
  cursor: "pointer",
  whiteSpace: "nowrap",
};
