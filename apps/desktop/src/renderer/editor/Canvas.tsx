import React, { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { resolveSrc, isVideoSrc, Player, type Element } from "@kiosk/engine";
import { useEditor } from "./store.js";
import { importImageBlob, useProjectAssetBase, importImageFromPath } from "./assets.js";
import { collectTargets, snapMove, snapResize, snapRotation, type GuideLine, type SnapTargets } from "./snap.js";
import { MaskOverlay } from "./MaskOverlay.js";

/** On-screen snap threshold in px; converted to scene units via the scale. */
const SNAP_PX = 8;

/** Zoom constants */
const ZOOM_STEP = 0.1;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5.0;

/** First image File from a DataTransfer/clipboard items list, if any. */
function firstImageFile(items: DataTransferItemList | null, files: FileList | null): File | null {
  if (files) {
    for (const f of Array.from(files)) if (f.type.startsWith("image/")) return f;
  }
  if (items) {
    for (const it of Array.from(items)) {
      if (it.kind === "file" && it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) return f;
      }
    }
  }
  return null;
}

/**
 * The editing canvas: a scaled stage that renders the active scene with the
 * SAME ElementRenderer the Player uses, plus an editor overlay (selection box +
 * resize handles). Pointer math converts screen px → scene px via the stage
 * scale so drag/resize feel 1:1 regardless of zoom-to-fit.
 */

type DragState =
  | { kind: "move"; id: string; startX: number; startY: number; elX: number; elY: number; width: number; height: number }
  | {
      kind: "multi-move";
      elements: Array<{ id: string; startX: number; startY: number }>;
      startX: number;
      startY: number;
    }
  | {
      kind: "resize";
      id: string;
      handle: Handle;
      startX: number;
      startY: number;
      rect: { x: number; y: number; width: number; height: number };
    }
  | {
      kind: "rotate";
      id: string;
      startX: number;
      startY: number;
      startRotation: number;
      centerX: number;
      centerY: number;
    }
  | {
      kind: "marquee";
      startX: number;
      startY: number;
      currentX: number;
      currentY: number;
    }
  | null;

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const MIN_SIZE = 16;

/** Element types whose text content can be edited inline on the canvas. */
const TEXT_EDITABLE = new Set(["text", "button"]);
/** Which prop holds the editable string for each type. */
function textPropFor(type: string): "text" | "label" {
  return type === "button" ? "label" : "text";
}

/**
 * Recursively flatten all elements including children of layers.
 * Converts child coordinates from relative to absolute by accumulating parent offsets.
 */
function flattenElements(elements: Element[], parentX = 0, parentY = 0, parentLocked = false): Element[] {
  const result: Element[] = [];
  for (const el of elements) {
    const effectiveLocked = parentLocked || (el.locked ?? false);
    if (el.type !== "layer") {
      // Non-layer elements: add with absolute coordinates and inherited lock state
      result.push({
        ...el,
        x: el.x + parentX,
        y: el.y + parentY,
        locked: effectiveLocked,
      });
    }
    if (el.children) {
      // Layer elements: recurse with accumulated offset and lock state
      const offsetX = el.type === "layer" ? el.x : 0;
      const offsetY = el.type === "layer" ? el.y : 0;
      result.push(...flattenElements(el.children, parentX + offsetX, parentY + offsetY, effectiveLocked));
    }
  }
  return result;
}

/**
 * Find an element by ID, searching recursively through nested children.
 * Returns the element with absolute coordinates if it's nested in a layer.
 */
function findElementRecursive(elements: Element[], id: string, parentX = 0, parentY = 0): Element | null {
  for (const el of elements) {
    if (el.id === id) {
      // Found it - return with absolute coordinates if nested
      return el.type === "layer" ? el : {
        ...el,
        x: el.x + parentX,
        y: el.y + parentY,
      };
    }
    if (el.children) {
      const offsetX = el.type === "layer" ? el.x : 0;
      const offsetY = el.type === "layer" ? el.y : 0;
      const found = findElementRecursive(el.children, id, parentX + offsetX, parentY + offsetY);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Check if element OR its parent layer is locked.
 * Locked elements/layers cannot be selected or edited.
 */
function isLockedOrChildOfLocked(elements: Element[], id: string): boolean {
  for (const el of elements) {
    if (el.id === id) {
      // Direct match - check if locked
      return el.locked ?? false;
    }
    if ((el.type === "layer" || el.type === "collection") && el.children) {
      // Check children recursively
      const found = isLockedOrChildOfLocked(el.children, id);
      if (found) {
        // Child is locked, OR parent container is locked
        return true;
      }
      // Check if this parent is locked and contains the child
      if (el.locked && el.children.some(c => c.id === id || hasDescendant(c, id))) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Check if element has a descendant with given ID (recursive).
 */
function hasDescendant(el: Element, id: string): boolean {
  if (!el.children) return false;
  for (const child of el.children) {
    if (child.id === id) return true;
    if (hasDescendant(child, id)) return true;
  }
  return false;
}

export function Canvas({
  pauseCapture,
  resumeCapture
}: {
  pauseCapture: () => void;
  resumeCapture: () => void;
}) {

  const project = useEditor((s) => s.project);
  const scene = useEditor((s) => s.activeScene());
  const selectedId = useEditor((s) => s.selectedId);
  const selectedIds = useEditor((s) => s.selectedIds);
  const hoveredElementId = useEditor((s) => s.hoveredElementId);
  const editingId = useEditor((s) => s.editingId);
  const maskEditingId = useEditor((s) => s.maskEditingId);
  const selectElement = useEditor((s) => s.selectElement);
  const startTextEditing = useEditor((s) => s.startTextEditing);
  const exitTextEditing = useEditor((s) => s.exitTextEditing);
  const updateProps = useEditor((s) => s.updateElementProps);
  const addImageElement = useEditor((s) => s.addImageElement);
  const setVideoIncompatibility = useEditor((s) => s.setVideoIncompatibility);
  const filePath = useEditor((s) => s.filePath);
  const assetBaseUrl = useProjectAssetBase(filePath);
  // Canvas size is project-wide (one size for all scenes).
  const sceneW = useEditor((s) => s.project.width);
  const sceneH = useEditor((s) => s.project.height);
  const viewport = useEditor((s) => s.canvasViewport);
  const setUserZoom = useEditor((s) => s.setUserZoom);
  const setPan = useEditor((s) => s.setPan);

  const hostRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const finalScale = scale * viewport.userZoom;
  const [guides, setGuides] = useState<GuideLine[]>([]);
  const drag = useRef<DragState>(null);
  const [, forceUpdate] = useState({});
  // Tracks the previous pointer-down for manual double-click detection.
  const lastDown = useRef<{ id: string; t: number } | null>(null);
  // Snap targets computed once at drag start; whether Alt is held (overrides snap).
  const dragTargets = useRef<SnapTargets | null>(null);
  const altHeld = useRef(false);
  // Right-click pan state
  const panDrag = useRef<{ startX: number; startY: number; initialPanX: number; initialPanY: number } | null>(null);

  // Track Alt so it can temporarily invert snapping during a drag.
  useEffect(() => {
    const set = (e: KeyboardEvent) => {
      if (e.key === "Alt") altHeld.current = e.type === "keydown";
    };
    window.addEventListener("keydown", set);
    window.addEventListener("keyup", set);
    return () => {
      window.removeEventListener("keydown", set);
      window.removeEventListener("keyup", set);
    };
  }, []);

  // Fit-scale the fixed scene resolution into the available area.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const update = () => {
      const pad = 48; // breathing room around the stage
      const w = host.clientWidth - pad;
      const h = host.clientHeight - pad;
      setScale(Math.max(0.05, Math.min(w / sceneW, h / sceneH)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(host);
    return () => ro.disconnect();
  }, [sceneW, sceneH]);

  // Manual wheel event listener with { passive: false } to allow preventDefault
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const handleWheel = (e: WheelEvent) => {
      // Block zoom during active drag
      if (drag.current) return;

      e.preventDefault();

      const stage = host.querySelector("[data-stage]") as HTMLElement | null;
      if (!stage) return;

      // Calculate new zoom level
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      const st = useEditor.getState();
      const vp = st.canvasViewport;
      const oldZoom = vp.userZoom;
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, oldZoom + delta));

      if (newZoom === oldZoom) return; // Already at limit

      // Apply cursor-position zoom math
      const stageRect = stage.getBoundingClientRect();
      const stageCenterX = stageRect.left + stageRect.width / 2;
      const stageCenterY = stageRect.top + stageRect.height / 2;
      const cursorOffsetX = e.clientX - stageCenterX;
      const cursorOffsetY = e.clientY - stageCenterY;

      const oldScale = scaleRef.current * oldZoom;
      const newScale = scaleRef.current * newZoom;
      const scaleRatio = newScale / oldScale;

      const deltaX = cursorOffsetX * (scaleRatio - 1);
      const deltaY = cursorOffsetY * (scaleRatio - 1);

      const newPanX = vp.panX - deltaX;
      const newPanY = vp.panY - deltaY;

      // Update store
      setUserZoom(newZoom);
      setPan(newPanX, newPanY);
    };

    host.addEventListener("wheel", handleWheel, { passive: false });
    return () => host.removeEventListener("wheel", handleWheel);
  }, [setUserZoom, setPan]);

  const selected = selectedId ? findElementRecursive(scene.elements, selectedId) : null;
  const hoveredEl = hoveredElementId ? findElementRecursive(scene.elements, hoveredElementId) : null;
  const editingEl = editingId ? findElementRecursive(scene.elements, editingId) : null;
  const maskEditingEl = maskEditingId ? findElementRecursive(scene.elements, maskEditingId) : null;

  // Paste (Ctrl+V) an image from the clipboard -> add as an image element.
  useEffect(() => {
    async function onPaste(e: ClipboardEvent) {
      const file = firstImageFile(e.clipboardData?.items ?? null, e.clipboardData?.files ?? null);
      if (!file) return;
      e.preventDefault();
      const rel = await importImageBlob(file, file.name || "pasted.png");
      if (rel) addImageElement(rel);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addImageElement]);

  /** Convert a client (screen) point to scene coordinates via the stage rect. */
  function clientToScene(clientX: number, clientY: number): { x: number; y: number } {
    const stage = hostRef.current?.querySelector("[data-stage]") as HTMLElement | null;
    if (!stage) return { x: 100, y: 100 };
    const r = stage.getBoundingClientRect();
    return {
      x: Math.round((clientX - r.left) / finalScale),
      y: Math.round((clientY - r.top) / finalScale),
    };
  }

  async function onDrop(e: React.DragEvent) {
    const file = firstImageFile(e.dataTransfer?.items ?? null, e.dataTransfer?.files ?? null);
    if (!file) return;
    e.preventDefault();
    const pos = clientToScene(e.clientX, e.clientY);

    let rel: string | null = null;
    // If file has a path (from filesystem drag-drop), copy it to user-content.
    if ("path" in file && file.path) {
      rel = await importImageFromPath(file.path);
    } else {
      // Otherwise, import from blob (clipboard or web source).
      rel = await importImageBlob(file, file.name || "dropped.png");
    }

    if (rel) addImageElement(rel, pos);
  }

  /**
   * Fired by the embedded Player when a video already in the project fails to
   * decode at runtime (pre-existing asset, drag-dropped file, hand-edited
   * JSON). Re-probes to get codec names for the modal, then offers the same
   * re-encode/import-anyway/cancel choice as import-time detection; on
   * re-encode, patches the element's src to the new file.
   */
  async function onVideoIncompatible(elementId: string, src: string) {
    if (!isVideoSrc(src)) return;
    const probe = await window.kiosk.probeVideo(filePath, src);
    if (probe.supported !== false) return;

    const fileName = src.split(/[/\\]/).pop() ?? src;
    setVideoIncompatibility({
      fileName,
      relativePath: src,
      projectPath: filePath,
      videoCodec: probe.videoCodec,
      audioCodec: probe.audioCodec,
      reason: probe.reason,
      resolve: (newPath) => {
        if (newPath && newPath !== src) updateProps(elementId, { src: newPath });
      },
    });
  }

  // Keep scale in a ref so the (stable) drag handlers always read the current
  // value rather than a stale closure from the render they were created in.
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  // Stable drag handlers (created once) so window add/removeEventListener always
  // match references across re-renders. They read fresh state from refs and the
  // store, avoiding stale-closure bugs (e.g. dragging after toggling snap).
  const onPointerMove = useRef((e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const st = useEditor.getState();
    const sc = scaleRef.current * st.canvasViewport.userZoom;
    const snapOn = st.snapEnabled !== altHeld.current; // Alt inverts

    if (d.kind === "marquee") {
      // Update marquee box - store client coords, convert to scene on endDrag
      drag.current = { ...d, currentX: e.clientX, currentY: e.clientY };
      forceUpdate({}); // Trigger re-render to show marquee box
    } else if (d.kind === "multi-move") {
      const dx = (e.clientX - d.startX) / sc;
      const dy = (e.clientY - d.startY) / sc;
      // Move all elements by same delta (no snapping for multi-move)
      d.elements.forEach(({ id, startX, startY }) => {
        st.moveElement(id, Math.round(startX + dx), Math.round(startY + dy));
      });
      setGuides([]);
    } else if (d.kind === "move") {
      const dx = (e.clientX - d.startX) / sc;
      const dy = (e.clientY - d.startY) / sc;
      const threshold = SNAP_PX / sc;
      const targets = dragTargets.current;
      const rect = { x: Math.round(d.elX + dx), y: Math.round(d.elY + dy), width: d.width, height: d.height };
      if (snapOn && targets) {
        const r = snapMove(rect, targets, threshold);
        st.moveElement(d.id, r.x, r.y);
        setGuides(r.guides);
      } else {
        st.moveElement(d.id, rect.x, rect.y);
        setGuides([]);
      }
    } else if (d.kind === "resize") {
      const dx = (e.clientX - d.startX) / sc;
      const dy = (e.clientY - d.startY) / sc;
      const threshold = SNAP_PX / sc;
      const targets = dragTargets.current;
      const raw = applyResize(d.handle, d.rect, dx, dy);
      if (snapOn && targets) {
        const r = snapResize(raw, d.handle, targets, threshold);
        st.resizeElement(d.id, r.rect);
        setGuides(r.guides);
      } else {
        st.resizeElement(d.id, raw);
        setGuides([]);
      }
    } else if (d.kind === "rotate") {
      // Convert client coords to scene coords
      const stage = hostRef.current?.querySelector("[data-stage]") as HTMLElement | null;
      if (!stage) return;
      const r = stage.getBoundingClientRect();
      const sceneX = (e.clientX - r.left) / sc;
      const sceneY = (e.clientY - r.top) / sc;

      // Calculate angle from center to cursor
      const dx = sceneX - d.centerX;
      const dy = sceneY - d.centerY;
      const angleRad = Math.atan2(dy, dx);
      const angleDeg = angleRad * (180 / Math.PI);

      // Apply snapping (15° increments)
      let finalAngle = angleDeg;
      if (snapOn) {
        finalAngle = snapRotation(angleDeg);
      }

      st.updateElement(d.id, { rotation: Math.round(finalAngle) });
      setGuides([]);
    }
  }).current;

  const endDrag = useRef(() => {
    try {
      const d = drag.current;
      if (d?.kind === "marquee") {
        // Convert marquee to scene coords and select overlapping elements
        const stage = hostRef.current?.querySelector("[data-stage]") as HTMLElement | null;
        if (stage) {
          const r = stage.getBoundingClientRect();
          const st = useEditor.getState();
          const sc = scaleRef.current * st.canvasViewport.userZoom;

          const x1 = (Math.min(d.startX, d.currentX) - r.left) / sc;
          const y1 = (Math.min(d.startY, d.currentY) - r.top) / sc;
          const x2 = (Math.max(d.startX, d.currentX) - r.left) / sc;
          const y2 = (Math.max(d.startY, d.currentY) - r.top) / sc;

          const marqueeRect = { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };

          // Find all elements overlapping marquee (using flattened list for absolute coords)
          const scene = st.activeScene();
          const overlapping = flattenElements(scene.elements)
            .filter((el) => !isLockedOrChildOfLocked(scene.elements, el.id))
            .filter((el) => {
              // Check bounding box overlap (ignoring rotation for simplicity)
              return !(
                el.x + el.width < marqueeRect.x ||
                el.x > marqueeRect.x + marqueeRect.width ||
                el.y + el.height < marqueeRect.y ||
                el.y > marqueeRect.y + marqueeRect.height
              );
            })
            .map((el) => el.id);

          if (overlapping.length > 0) {
            st.selectElements(new Set(overlapping));
          }
        }
      }

      drag.current = null;
      dragTargets.current = null;
      setGuides([]);
    } finally {
      // ALWAYS clean up listeners and resume capture, even if exception occurs above
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", endDrag);
      resumeCapture(); // Resume history tracking and capture final position
    }
  }).current;

  const onPanMove = useRef((e: PointerEvent) => {
    const pd = panDrag.current;
    if (!pd) return;

    const dx = e.clientX - pd.startX;
    const dy = e.clientY - pd.startY;

    setPan(pd.initialPanX + dx, pd.initialPanY + dy);
  }).current;

  const onPanEnd = useRef(() => {
    panDrag.current = null;
    if (hostRef.current) hostRef.current.style.cursor = "";
    window.removeEventListener("pointermove", onPanMove);
    window.removeEventListener("pointerup", onPanEnd);
  }).current;

  /** Snap targets from every element EXCEPT the one being dragged, + canvas. */
  function buildTargets(draggedId: string): SnapTargets {
    return collectTargets(scene.elements.filter((e) => e.id !== draggedId), sceneW, sceneH);
  }

  function beginMove(e: ReactPointerEvent, el: Element) {
    e.stopPropagation();
    // Block if element or parent layer is locked
    if (isLockedOrChildOfLocked(scene.elements, el.id)) return;

    // Multi-select move: clicked element is part of selection
    if (selectedIds.size > 1 && selectedIds.has(el.id)) {
      pauseCapture();
      const elements = Array.from(selectedIds)
        .map((id) => {
          const elem = findElementRecursive(scene.elements, id);
          return elem ? { id, startX: elem.x, startY: elem.y } : null;
        })
        .filter((e): e is { id: string; startX: number; startY: number } => e !== null);

      drag.current = {
        kind: "multi-move",
        elements,
        startX: e.clientX,
        startY: e.clientY,
      };
      dragTargets.current = buildTargets(el.id); // Use clicked element for snap targets
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", endDrag);
      return;
    }

    // Single-select move
    selectElement(el.id);
    pauseCapture(); // Pause history tracking during drag
    drag.current = {
      kind: "move",
      id: el.id,
      startX: e.clientX,
      startY: e.clientY,
      elX: el.x,
      elY: el.y,
      width: el.width,
      height: el.height,
    };
    dragTargets.current = buildTargets(el.id);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
  }

  function beginResize(e: ReactPointerEvent, el: Element, handle: Handle) {
    e.stopPropagation();
    // Block if element or parent layer is locked
    if (isLockedOrChildOfLocked(scene.elements, el.id)) return;
    pauseCapture(); // Pause history tracking during resize
    drag.current = {
      kind: "resize",
      id: el.id,
      handle,
      startX: e.clientX,
      startY: e.clientY,
      rect: { x: el.x, y: el.y, width: el.width, height: el.height },
    };
    dragTargets.current = buildTargets(el.id);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
  }

  function beginRotate(e: ReactPointerEvent, el: Element) {
    e.stopPropagation();
    // Block if element or parent layer is locked
    if (isLockedOrChildOfLocked(scene.elements, el.id)) return;
    pauseCapture(); // Pause history tracking during rotation
    const centerX = el.x + el.width / 2;
    const centerY = el.y + el.height / 2;
    drag.current = {
      kind: "rotate",
      id: el.id,
      startX: e.clientX,
      startY: e.clientY,
      startRotation: el.rotation,
      centerX,
      centerY,
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
  }

  function beginTextEdit(el: Element) {
    if (!TEXT_EDITABLE.has(el.type)) return;
    startTextEditing(el.id);
  }

  return (
    <div
      ref={hostRef}
      onPointerDown={(e) => {
        // Right-click initiates pan
        if (e.button === 2) {
          e.preventDefault();
          e.stopPropagation();
          panDrag.current = {
            startX: e.clientX,
            startY: e.clientY,
            initialPanX: viewport.panX,
            initialPanY: viewport.panY,
          };
          if (hostRef.current) hostRef.current.style.cursor = "grabbing";
          window.addEventListener("pointermove", onPanMove);
          window.addEventListener("pointerup", onPanEnd);
        } else if (!maskEditingId) {
          // Left-click on canvas background -> start marquee selection
          selectElement(null);
          exitTextEditing();

          drag.current = {
            kind: "marquee",
            startX: e.clientX,
            startY: e.clientY,
            currentX: e.clientX,
            currentY: e.clientY,
          };
          window.addEventListener("pointermove", onPointerMove);
          window.addEventListener("pointerup", endDrag);
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      style={{
        position: "relative",
        flex: 1,
        minWidth: 0,
        background: "#11151c",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <div
        data-stage
        style={{
          width: sceneW,
          height: sceneH,
          position: "relative",
          transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${finalScale})`,
          transformOrigin: "center center",
          ...((!scene.background || scene.background.startsWith('#'))
            ? { background: scene.background }
            : isVideoSrc(scene.background)
              // The real video is rendered by the embedded <Player> below,
              // which fully covers this div — CSS can't autoplay a video via
              // background-image, so this is just a color fallback.
              ? { background: "#000000" }
              : {
                  backgroundImage: `url(${resolveSrc(scene.background, assetBaseUrl)})`,
                  backgroundSize: scene.backgroundSize === 'fill' ? '100% 100%' : (scene.backgroundSize || 'cover'),
                  backgroundPosition: scene.backgroundPosition || 'center',
                  backgroundRepeat: 'no-repeat',
                }),
          boxShadow: "0 0 0 1px #2a3441, 0 20px 60px rgba(0,0,0,0.5)",
          flexShrink: 0,
        }}
      >
        {/* Visual layer: Player component renders the full scene with working
            video elements and interaction context. Pointer events are off so
            hit-testing happens on the per-element overlay below. */}
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          {editingId && (
            <style>{`
              [data-element-id="${editingId}"] {
                visibility: hidden !important;
              }
            `}</style>
          )}
          {selectedId && !editingId && (
            <style>{`
              [data-element-id="${selectedId}"] {
                z-index: 999999 !important;
              }
            `}</style>
          )}
          <Player
            project={project}
            initialSceneId={scene.id}
            assetBaseUrl={assetBaseUrl}
            live={true}
            editorMode={true}
            onIncompatible={onVideoIncompatible}
          />
        </div>

        {/* Interaction layer: one transparent box per element matching its real
            rect, so a click hits the element actually under the cursor (not the
            topmost full-stage wrapper). zIndex mirrors draw order.
            Layers are excluded (not selectable on canvas), but their children are included. */}
        {flattenElements(scene.elements).map((el) => (
          <div
            key={`hit-${el.id}`}
            onPointerDown={(e) => {
              // Right-click should not interact with elements (used for pan)
              if (e.button === 2) return;
              // Clear any stuck text-editing state before selecting/moving
              exitTextEditing();

              const now = Date.now();
              const last = lastDown.current;
              lastDown.current = { id: el.id, t: now };
              // Two pointerdowns on the same element within 350ms = double-click
              // (native dblclick is unreliable when the pointer doesn't move).
              if (last && last.id === el.id && now - last.t < 350) {
                e.stopPropagation();
                lastDown.current = null;
                beginTextEdit(el);
                return;
              }
              beginMove(e, el);
            }}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: el.width,
              height: el.height,
              transform: `translate(${el.x}px, ${el.y}px) rotate(${el.rotation}deg)`,
              transformOrigin: "center center",
              // Selected element gets mechanical priority (999999) to match visual priority
              zIndex: selectedId === el.id ? 999999 : el.zIndex,
              // Locked elements and elements being text-edited get no pointer events,
              // so clicks fall through to the selectable element underneath.
              pointerEvents: editingId === el.id || el.locked ? "none" : "auto",
              cursor: "move",
            }}
          />
        ))}

        {editingEl && (
          <InlineTextEditor
            element={editingEl}
            scale={finalScale}
            onChange={(v) => updateProps(editingEl.id, { [textPropFor(editingEl.type)]: v })}
            onDone={() => exitTextEditing()}
          />
        )}

        {maskEditingEl && (
          <MaskOverlay
            element={maskEditingEl}
            scale={finalScale}
            pauseCapture={pauseCapture}
            resumeCapture={resumeCapture}
          />
        )}

        {/* Single-select overlay */}
        {selected && !editingEl && !maskEditingEl && selectedIds.size === 0 && (
          <SelectionOverlay element={selected} scale={finalScale} onResize={beginResize} onRotate={beginRotate} />
        )}

        {/* Multi-select overlays (no handles, just outline) */}
        {selectedIds.size > 0 && !editingEl && !maskEditingEl &&
          Array.from(selectedIds).map((id) => {
            const el = findElementRecursive(scene.elements, id);
            if (!el) return null;
            return (
              <div
                key={`sel-${id}`}
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: el.width,
                  height: el.height,
                  transform: `translate(${el.x}px, ${el.y}px) rotate(${el.rotation}deg)`,
                  transformOrigin: "center center",
                  outline: `${2 / finalScale}px solid #38bdf8`,
                  zIndex: 999999,
                  pointerEvents: "none",
                }}
              />
            );
          })
        }

        {/* Hover outline (e.g. hovering an override row in the States panel) — visual only, doesn't affect selection */}
        {hoveredEl && hoveredElementId !== selectedId && !selectedIds.has(hoveredElementId ?? "") && !editingEl && !maskEditingEl && (
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: hoveredEl.width,
              height: hoveredEl.height,
              transform: `translate(${hoveredEl.x}px, ${hoveredEl.y}px) rotate(${hoveredEl.rotation}deg)`,
              transformOrigin: "center center",
              outline: `${2 / finalScale}px dashed #f59e0b`,
              zIndex: 999998,
              pointerEvents: "none",
            }}
          />
        )}

        {/* Marquee selection box */}
        {drag.current?.kind === "marquee" && (() => {
          const d = drag.current;
          const stage = hostRef.current?.querySelector("[data-stage]") as HTMLElement | null;
          if (!stage) return null;
          const r = stage.getBoundingClientRect();

          const x1 = (Math.min(d.startX, d.currentX) - r.left) / finalScale;
          const y1 = (Math.min(d.startY, d.currentY) - r.top) / finalScale;
          const x2 = (Math.max(d.startX, d.currentX) - r.left) / finalScale;
          const y2 = (Math.max(d.startY, d.currentY) - r.top) / finalScale;

          return (
            <div
              style={{
                position: "absolute",
                left: x1,
                top: y1,
                width: x2 - x1,
                height: y2 - y1,
                border: `${2 / finalScale}px solid #38bdf8`,
                background: "rgba(56, 189, 248, 0.1)",
                pointerEvents: "none",
                zIndex: 999999,
              }}
            />
          );
        })()}

        {/* Alignment guides: thin lines at snapped positions during a drag. */}
        {guides.map((g, i) =>
          g.axis === "x" ? (
            <div
              key={`gx-${i}`}
              style={{
                position: "absolute",
                left: g.pos,
                top: 0,
                width: 1 / finalScale,
                height: sceneH,
                background: "#f472b6",
                pointerEvents: "none",
                zIndex: 99999,
              }}
            />
          ) : (
            <div
              key={`gy-${i}`}
              style={{
                position: "absolute",
                left: 0,
                top: g.pos,
                width: sceneW,
                height: 1 / finalScale,
                background: "#f472b6",
                pointerEvents: "none",
                zIndex: 99999,
              }}
            />
          )
        )}
      </div>
    </div>
  );
}

/**
 * An overlaid editable field positioned exactly over a text/button element. We
 * use a contentEditable div (not a textarea) styled to mirror ElementRenderer's
 * flex layout, so the glyphs sit in the SAME place while editing — text is
 * vertically centered, buttons centered both axes. Commits on each input
 * (store is source of truth); Enter or Escape or blur ends editing.
 */
function InlineTextEditor({
  element,
  scale,
  onChange,
  onDone,
}: {
  element: Element;
  scale: number;
  onChange: (value: string) => void;
  onDone: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const prop = textPropFor(element.type);
  const value = typeof element.props[prop] === "string" ? (element.props[prop] as string) : "";
  const isButton = element.type === "button";
  // Blur fires spuriously right after mount (the opening double-click's trailing
  // pointer events steal focus). Ignore blur until the field has truly settled.
  const ready = useRef(false);

  // Set initial text, then focus + select-all after the opening click settles.
  // We do NOT rebind value into the DOM on later renders — that resets the
  // caret. The store stays in sync via onInput; the DOM is the editing surface.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.textContent = value;
    const focusAndSelect = () => {
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      ready.current = true;
    };
    // Defer past the trailing pointerup/click of the opening double-click.
    const t = window.setTimeout(focusAndSelect, 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      // Stop these from bubbling to the canvas background (which would close
      // editing) so you can click within the text to place the caret.
      onPointerDown={(e) => e.stopPropagation()}
      onInput={(e) => onChange(e.currentTarget.textContent ?? "")}
      onBlur={() => {
        // Only commit on blur once the field has actually held focus.
        if (ready.current) onDone();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey)) {
          e.preventDefault();
          onDone();
        }
      }}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: element.width,
        height: element.height,
        transform: `translate(${element.x}px, ${element.y}px) rotate(${element.rotation}deg)`,
        transformOrigin: "center center",
        boxSizing: "border-box",
        // Match ElementRenderer's text/button layout exactly:
        display: "flex",
        alignItems: "center",
        justifyContent: isButton ? "center" : "flex-start",
        whiteSpace: "pre-wrap",
        overflow: "hidden",
        outline: `${2 / scale}px solid #38bdf8`,
        background: "rgba(8,12,18,0.35)",
        color: str(element.props.color, "#ffffff"),
        fontSize: num(element.props.fontSize, isButton ? 28 : 32),
        fontWeight: isButton ? "normal" : str(element.props.fontWeight, "normal"),
        fontFamily: str(element.props.fontFamily, "system-ui, sans-serif"),
        textAlign: (isButton ? "center" : str(element.props.align, "left")) as CSSProperties["textAlign"],
        cursor: "text",
        zIndex: 10000,
      }}
    />
  );
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}
function num(v: unknown, fallback: number): number {
  return typeof v === "number" ? v : fallback;
}

function SelectionOverlay({
  element,
  scale,
  onResize,
  onRotate,
}: {
  element: Element;
  scale: number;
  onResize: (e: ReactPointerEvent, el: Element, handle: Handle) => void;
  onRotate: (e: ReactPointerEvent, el: Element) => void;
}) {
  const visualSize = 10 / scale; // keep visual handles a constant on-screen size
  const hitSize = 20 / scale; // larger hit area for easier grabbing
  const rotationHandleSize = 20 / scale;
  const rotationHandleDistance = 30 / scale;

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: element.width,
        height: element.height,
        transform: `translate(${element.x}px, ${element.y}px) rotate(${element.rotation}deg)`,
        transformOrigin: "center center",
        outline: `${2 / scale}px solid #38bdf8`,
        zIndex: 999999,
        pointerEvents: "none",
      }}
    >
      {/* Connection line from top-center to rotation handle */}
      <div
        style={{
          position: "absolute",
          left: element.width / 2 - 0.5 / scale,
          top: -rotationHandleDistance,
          width: 1 / scale,
          height: rotationHandleDistance,
          background: "#38bdf8",
          pointerEvents: "none",
        }}
      />

      {/* Rotation handle */}
      <div
        onPointerDown={(e) => onRotate(e, element)}
        style={{
          position: "absolute",
          left: element.width / 2 - rotationHandleSize / 2,
          top: -rotationHandleDistance - rotationHandleSize / 2,
          width: rotationHandleSize,
          height: rotationHandleSize,
          background: "#38bdf8",
          border: `${2 / scale}px solid #0b1016`,
          borderRadius: "50%",
          pointerEvents: "auto",
          cursor: "grab",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 999998,
        }}
      >
        {/* Rotation icon (circular arrow) */}
        <svg
          width={rotationHandleSize * 0.6}
          height={rotationHandleSize * 0.6}
          viewBox="0 0 24 24"
          fill="none"
          stroke="#0b1016"
          strokeWidth="2"
          style={{ pointerEvents: "none" }}
        >
          <path d="M21 12a9 9 0 11-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
        </svg>
      </div>

      {/* Resize handles */}
      {HANDLES.map((h) => (
        <div
          key={h}
          onPointerDown={(e) => onResize(e, element, h)}
          style={{
            position: "absolute",
            width: hitSize,
            height: hitSize,
            pointerEvents: "auto",
            cursor: `${h}-resize`,
            zIndex: 999998,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            ...handlePosition(h, element.width, element.height, hitSize),
          }}
        >
          <div
            style={{
              width: visualSize,
              height: visualSize,
              background: "#38bdf8",
              border: `${1 / scale}px solid #0b1016`,
              pointerEvents: "none",
            }}
          />
        </div>
      ))}
    </div>
  );
}

function handlePosition(h: Handle, w: number, hgt: number, s: number) {
  const mid = (n: number) => n / 2 - s / 2;
  const end = (n: number) => n - s / 2;
  const map: Record<Handle, { left: number; top: number }> = {
    nw: { left: -s / 2, top: -s / 2 },
    n: { left: mid(w), top: -s / 2 },
    ne: { left: end(w), top: -s / 2 },
    e: { left: end(w), top: mid(hgt) },
    se: { left: end(w), top: end(hgt) },
    s: { left: mid(w), top: end(hgt) },
    sw: { left: -s / 2, top: end(hgt) },
    w: { left: -s / 2, top: mid(hgt) },
  };
  return map[h];
}

/** Compute a new rect from a resize handle drag (scene-space deltas). */
function applyResize(
  h: Handle,
  r: { x: number; y: number; width: number; height: number },
  dx: number,
  dy: number
) {
  let { x, y, width, height } = r;
  const right = r.x + r.width;
  const bottom = r.y + r.height;

  if (h.includes("e")) width = Math.max(MIN_SIZE, r.width + dx);
  if (h.includes("s")) height = Math.max(MIN_SIZE, r.height + dy);
  if (h.includes("w")) {
    width = Math.max(MIN_SIZE, r.width - dx);
    x = right - width;
  }
  if (h.includes("n")) {
    height = Math.max(MIN_SIZE, r.height - dy);
    y = bottom - height;
  }
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}
