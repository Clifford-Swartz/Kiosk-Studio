import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { ElementRenderer, resolveBindings, useBindingValues, type Element } from "@kiosk/engine";
import { useEditor } from "./store.js";
import { importImageBlob, projectAssetBase, importImageFromPath } from "./assets.js";
import { collectTargets, snapMove, snapResize, type GuideLine, type SnapTargets } from "./snap.js";

/** On-screen snap threshold in px; converted to scene units via the scale. */
const SNAP_PX = 8;

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
      kind: "resize";
      id: string;
      handle: Handle;
      startX: number;
      startY: number;
      rect: { x: number; y: number; width: number; height: number };
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

export function Canvas({
  pauseCapture,
  resumeCapture
}: {
  pauseCapture: () => void;
  resumeCapture: () => void;
}) {

  const scene = useEditor((s) => s.activeScene());
  const selectedId = useEditor((s) => s.selectedId);
  const selectElement = useEditor((s) => s.selectElement);
  const updateProps = useEditor((s) => s.updateElementProps);
  const addImageElement = useEditor((s) => s.addImageElement);
  const filePath = useEditor((s) => s.filePath);
  const assetBaseUrl = projectAssetBase(filePath);
  const getValue = useBindingValues(); // live data for canvas preview
  // Canvas size is project-wide (one size for all scenes).
  const sceneW = useEditor((s) => s.project.width);
  const sceneH = useEditor((s) => s.project.height);

  const hostRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [guides, setGuides] = useState<GuideLine[]>([]);
  const drag = useRef<DragState>(null);
  // Tracks the previous pointer-down for manual double-click detection.
  const lastDown = useRef<{ id: string; t: number } | null>(null);
  // Snap targets computed once at drag start; whether Alt is held (overrides snap).
  const dragTargets = useRef<SnapTargets | null>(null);
  const altHeld = useRef(false);

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

  const selected = scene.elements.find((e) => e.id === selectedId) ?? null;
  const editingEl = scene.elements.find((e) => e.id === editingId) ?? null;

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
      x: Math.round((clientX - r.left) / scale),
      y: Math.round((clientY - r.top) / scale),
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
    const sc = scaleRef.current;
    const dx = (e.clientX - d.startX) / sc;
    const dy = (e.clientY - d.startY) / sc;
    const threshold = SNAP_PX / sc;
    const targets = dragTargets.current;
    const st = useEditor.getState();
    const snapOn = st.snapEnabled !== altHeld.current; // Alt inverts

    if (d.kind === "move") {
      const rect = { x: Math.round(d.elX + dx), y: Math.round(d.elY + dy), width: d.width, height: d.height };
      if (snapOn && targets) {
        const r = snapMove(rect, targets, threshold);
        st.moveElement(d.id, r.x, r.y);
        setGuides(r.guides);
      } else {
        st.moveElement(d.id, rect.x, rect.y);
        setGuides([]);
      }
    } else {
      const raw = applyResize(d.handle, d.rect, dx, dy);
      if (snapOn && targets) {
        const r = snapResize(raw, d.handle, targets, threshold);
        st.resizeElement(d.id, r.rect);
        setGuides(r.guides);
      } else {
        st.resizeElement(d.id, raw);
        setGuides([]);
      }
    }
  }).current;

  const endDrag = useRef(() => {
    try {
      drag.current = null;
      dragTargets.current = null;
      setGuides([]);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", endDrag);
    } finally {
      // ALWAYS resume capture, even if exception occurs above
      resumeCapture(); // Resume history tracking and capture final position
    }
  }).current;

  /** Snap targets from every element EXCEPT the one being dragged, + canvas. */
  function buildTargets(draggedId: string): SnapTargets {
    return collectTargets(scene.elements.filter((e) => e.id !== draggedId), sceneW, sceneH);
  }

  function beginMove(e: ReactPointerEvent, el: Element) {
    e.stopPropagation();
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

  function beginTextEdit(el: Element) {
    if (!TEXT_EDITABLE.has(el.type)) return;
    selectElement(el.id);
    setEditingId(el.id);
  }

  return (
    <div
      ref={hostRef}
      onPointerDown={() => {
        selectElement(null);
        setEditingId(null);
      }}
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
          transform: `scale(${scale})`,
          transformOrigin: "center center",
          background: scene.background,
          boxShadow: "0 0 0 1px #2a3441, 0 20px 60px rgba(0,0,0,0.5)",
          flexShrink: 0,
        }}
      >
        {/* Visual layer: the Player's renderer, with interactions inert. The
            renderer positions each element at its own (x,y,w,h); pointer events
            are off so hit-testing happens on the per-element overlay below. */}
        {scene.elements.map((el) => (
          <div
            key={el.id}
            style={{
              pointerEvents: "none",
              visibility: editingId === el.id ? "hidden" : "visible",
            }}
          >
            <ElementRenderer element={resolveBindings(el, getValue)} assetBaseUrl={assetBaseUrl} />
          </div>
        ))}

        {/* Interaction layer: one transparent box per element matching its real
            rect, so a click hits the element actually under the cursor (not the
            topmost full-stage wrapper). zIndex mirrors draw order. */}
        {scene.elements.map((el) => (
          <div
            key={`hit-${el.id}`}
            onPointerDown={(e) => {
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
              zIndex: el.zIndex,
              // Hidden hit target while editing this element, so clicks reach the
              // inline editor instead of restarting a drag.
              pointerEvents: editingId === el.id ? "none" : "auto",
              cursor: "move",
            }}
          />
        ))}

        {editingEl && (
          <InlineTextEditor
            element={editingEl}
            scale={scale}
            onChange={(v) => updateProps(editingEl.id, { [textPropFor(editingEl.type)]: v })}
            onDone={() => setEditingId(null)}
          />
        )}

        {selected && !editingEl && (
          <SelectionOverlay element={selected} scale={scale} onResize={beginResize} />
        )}

        {/* Alignment guides: thin lines at snapped positions during a drag. */}
        {guides.map((g, i) =>
          g.axis === "x" ? (
            <div
              key={`gx-${i}`}
              style={{
                position: "absolute",
                left: g.pos,
                top: 0,
                width: 1 / scale,
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
                height: 1 / scale,
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
}: {
  element: Element;
  scale: number;
  onResize: (e: ReactPointerEvent, el: Element, handle: Handle) => void;
}) {
  const handleSize = 10 / scale; // keep handles a constant on-screen size
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
        pointerEvents: "none",
      }}
    >
      {HANDLES.map((h) => (
        <div
          key={h}
          onPointerDown={(e) => onResize(e, element, h)}
          style={{
            position: "absolute",
            width: handleSize,
            height: handleSize,
            background: "#38bdf8",
            border: `${1 / scale}px solid #0b1016`,
            pointerEvents: "auto",
            cursor: `${h}-resize`,
            ...handlePosition(h, element.width, element.height, handleSize),
          }}
        />
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
