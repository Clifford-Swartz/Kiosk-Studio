import React, { useState, useRef, useEffect } from "react";
import type { LayerMask } from "@kiosk/engine";
import { useEditor } from "./store.js";

type Tool = "rect" | "polygon";
type Point = [number, number];

interface MaskEditorProps {
  layerId: string;
  onClose: () => void;
}

/**
 * Modal for creating and editing layer masks. Click-drag for rectangles,
 * click to add polygon points (double-click or Enter to close shape).
 */
export function MaskEditorModal({ layerId, onClose }: MaskEditorProps) {
  const scene = useEditor((s) => s.activeScene());
  const project = useEditor((s) => s.project);
  const updateElement = useEditor((s) => s.updateElement);

  const layer = scene.elements.find((e) => e.id === layerId);
  if (!layer || layer.type !== "layer") {
    onClose();
    return null;
  }

  const [tool, setTool] = useState<Tool>("rect");
  const [mask, setMask] = useState<LayerMask | null>(layer.mask ?? null);
  const [tempPoints, setTempPoints] = useState<Point[]>([]);
  const [editingPointIndex, setEditingPointIndex] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const sceneWidth = project.width;
  const sceneHeight = project.height;

  // Calculate fit-contain dimensions to preserve aspect ratio
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasStyle, setCanvasStyle] = useState({ width: sceneWidth, height: sceneHeight });

  useEffect(() => {
    const updateCanvasSize = () => {
      const container = containerRef.current;
      if (!container) return;

      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;

      const scaleX = containerWidth / sceneWidth;
      const scaleY = containerHeight / sceneHeight;
      const scale = Math.min(scaleX, scaleY);

      setCanvasStyle({
        width: sceneWidth * scale,
        height: sceneHeight * scale,
      });
    };

    updateCanvasSize();
    const observer = new ResizeObserver(updateCanvasSize);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [sceneWidth, sceneHeight]);

  // Draw the scene preview + mask overlay
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear canvas
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw scene elements (desaturated, read-only preview)
    ctx.save();
    ctx.filter = "grayscale(0.8) opacity(0.4)";
    scene.elements.forEach((el) => {
      if (el.id === layerId) return; // Skip the layer itself
      ctx.fillStyle = "#64748b";
      ctx.fillRect(el.x, el.y, el.width, el.height);
    });
    ctx.restore();

    // Draw mask preview
    const activeMask = mask ?? (tempPoints.length > 0 ? { type: tool, points: tempPoints } as LayerMask : null);
    if (activeMask) {
      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth = 2;
      ctx.fillStyle = "rgba(59, 130, 246, 0.3)";

      ctx.beginPath();
      activeMask.points.forEach(([x, y], i) => {
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      if (activeMask.type === "rect" && activeMask.points.length === 2) {
        const [x1, y1] = activeMask.points[0];
        const [x2, y2] = activeMask.points[1];
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#0f172a";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Redraw scene elements after clear
        ctx.save();
        ctx.filter = "grayscale(0.8) opacity(0.4)";
        scene.elements.forEach((el) => {
          if (el.id === layerId) return;
          ctx.fillStyle = "#64748b";
          ctx.fillRect(el.x, el.y, el.width, el.height);
        });
        ctx.restore();

        ctx.fillStyle = "rgba(59, 130, 246, 0.3)";
        ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      } else {
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }

      // Draw control points
      activeMask.points.forEach(([x, y], i) => {
        ctx.fillStyle = editingPointIndex === i ? "#f59e0b" : "#3b82f6";
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }, [mask, tempPoints, tool, editingPointIndex, scene.elements, layerId, sceneWidth, sceneHeight]);

  const getCanvasPoint = (e: React.MouseEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return [0, 0];
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * sceneWidth;
    const y = ((e.clientY - rect.top) / rect.height) * sceneHeight;
    return [Math.round(x), Math.round(y)];
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const point = getCanvasPoint(e);

    // Check if clicking on existing control point (edit mode)
    const activeMask = mask ?? (tempPoints.length > 0 ? { type: tool, points: tempPoints } as LayerMask : null);
    if (activeMask) {
      const clickedIndex = activeMask.points.findIndex(([x, y]) => {
        const dx = point[0] - x;
        const dy = point[1] - y;
        return Math.sqrt(dx * dx + dy * dy) < 10;
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

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging) return;
    const point = getCanvasPoint(e);

    if (editingPointIndex !== null) {
      // Drag existing point
      const activeMask = mask ?? { type: tool, points: tempPoints };
      const newPoints = [...activeMask.points];
      newPoints[editingPointIndex] = point;
      if (mask) {
        setMask({ ...mask, points: newPoints });
      } else {
        setTempPoints(newPoints);
      }
    } else if (tool === "rect" && tempPoints.length === 1) {
      // Drag rect second corner
      setTempPoints([tempPoints[0], point]);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    if (tool === "rect" && tempPoints.length === 2) {
      setMask({ type: "rect", points: tempPoints });
      setTempPoints([]);
    }
    setEditingPointIndex(null);
  };

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
    }
  };

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [tool, tempPoints]);

  const handleSave = () => {
    if (mask) {
      updateElement(layerId, { mask });
    }
    onClose();
  };

  const handleDeleteMask = () => {
    setMask(null);
    setTempPoints([]);
    updateElement(layerId, { mask: undefined });
    onClose();
  };

  return (
    <div style={overlay}>
      <div style={modal}>
        <div style={toolbar}>
          <button
            style={{
              ...toolBtn,
              background: tool === "rect" ? "#2563eb" : "#161c26",
              color: tool === "rect" ? "#fff" : "#e2e8f0",
            }}
            onClick={() => setTool("rect")}
          >
            Rectangle
          </button>
          <button
            style={{
              ...toolBtn,
              background: tool === "polygon" ? "#2563eb" : "#161c26",
              color: tool === "polygon" ? "#fff" : "#e2e8f0",
            }}
            onClick={() => setTool("polygon")}
          >
            Polygon
          </button>
          <button style={{ ...toolBtn, marginLeft: "auto", color: "#fca5a5" }} onClick={handleDeleteMask}>
            Delete Mask
          </button>
          <button style={toolBtn} onClick={onClose}>
            Cancel
          </button>
          <button style={{ ...toolBtn, background: "#2563eb", color: "#fff" }} onClick={handleSave}>
            Done
          </button>
        </div>
        <div
          ref={containerRef}
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          <canvas
            ref={canvasRef}
            width={sceneWidth}
            height={sceneHeight}
            style={{
              width: canvasStyle.width,
              height: canvasStyle.height,
              cursor: isDragging ? "crosshair" : "default",
            }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onDoubleClick={handleDoubleClick}
          />
        </div>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: "rgba(0, 0, 0, 0.8)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999,
};

const modal: React.CSSProperties = {
  background: "#0e1218",
  border: "1px solid #1f2733",
  borderRadius: 12,
  width: "90vw",
  height: "90vh",
  maxWidth: 1600,
  maxHeight: 900,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const toolbar: React.CSSProperties = {
  display: "flex",
  gap: 8,
  padding: 12,
  background: "#161c26",
  borderBottom: "1px solid #1f2733",
};

const toolBtn: React.CSSProperties = {
  padding: "8px 16px",
  background: "#161c26",
  border: "1px solid #232c3a",
  borderRadius: 6,
  color: "#e2e8f0",
  fontSize: 13,
  cursor: "pointer",
};
