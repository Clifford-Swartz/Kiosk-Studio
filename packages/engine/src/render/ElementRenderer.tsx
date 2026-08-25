import React, { useEffect, useRef, useState } from "react";
import type { Element } from "../model/types.js";
import { CollectionRenderer } from "./collections/CollectionRenderer.js";
import { VideoControls } from "./VideoControls.js";
import { eventBus } from "../events/EventBus.js";
import { imageLoadQueue } from "../runtime/ImageLoadQueue.js";
import { VisibilityManager } from "../runtime/VisibilityManager.js";
import { plainTextToRichTextDoc, type RichTextDoc } from "../model/richText.js";

export interface ElementRendererProps {
  element: Element;
  /** Fired when an element with a `tap` interaction is activated. */
  onTap?: (element: Element) => void;
  /** Fired when an element with a `hover` interaction is entered. */
  onHover?: (element: Element) => void;
  /** Fired when an element with a `hoverEnd` interaction is left. */
  onHoverEnd?: (element: Element) => void;
  /** Fired when an element with a `press` interaction is pointer-pressed. */
  onPress?: (element: Element) => void;
  /** Fired when an element with a `release` interaction is pointer-released. */
  onRelease?: (element: Element) => void;
  /**
   * Base URL for resolving relative asset `src` values (e.g. "assets/x.png").
   * Typically a `file://<projectDir>/` URL. Absolute URLs pass through.
   */
  assetBaseUrl?: string;
  /** True in the Player; enables time-based behavior (e.g. Ken Burns auto-advance). */
  playing?: boolean;
  /** Callback to register audio elements by ID for playback control. */
  onAudioRef?: (elementId: string, ref: HTMLAudioElement | null) => void;
  /** Callback to register video elements by ID for playback control. */
  onVideoRef?: (elementId: string, ref: HTMLVideoElement | null) => void;
  /** Fired when a video element reports a DECODE/SRC_NOT_SUPPORTED playback error. */
  onIncompatible?: (elementId: string, src: string) => void;
  /** True when rendering in editor mode; disables button interaction overlays. */
  editorMode?: boolean;
  /**
   * Resolves an element through the binding/state/override/animation pipeline.
   * Applied to children too, so elements nested in a "layer" container pick up
   * scene-state and binding overrides the same as top-level elements.
   */
  resolveElement?: (element: Element) => Element;
  /**
   * Nearest ancestor "layer" id of the currently-selected element (null for the
   * root/base layer). Editor-only dimming (see `editorDim` below) only applies
   * within this layer, so switching selection to a different layer stops
   * showing invisible elements elsewhere.
   */
  activeLayerId?: string | null;
  /**
   * Nearest ancestor "layer" id of the element currently being rendered (null
   * at the root). Threaded through recursive children by this component —
   * callers should not pass this explicitly except when re-rendering a
   * "layer" element's own children.
   */
  currentLayerId?: string | null;
  /**
   * Ids of "layer" elements that should dim (rather than fully hide) when
   * invisible: the layer itself is selected, or the selection is somewhere
   * inside it. A layer container is its own dimming boundary — unlike a leaf
   * element (governed by activeLayerId/currentLayerId "same layer" sibling
   * matching), a layer's own visibility must key off selection *containment*,
   * since dimming it to 0.4 opacity cascades (via CSS opacity) to every
   * descendant regardless of each child's own visible flag. Same reference
   * passed unchanged through recursion — only consulted for type === "layer".
   */
  dimmableLayerIds?: Set<string> | null;
}

// Embedded fallback: 1×1 transparent PNG data URI (for empty src fields)
const FALLBACK_DATA_URI = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

// Embedded placeholder: gray rectangle with "Image" text as SVG
const PLACEHOLDER_FALLBACK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='240' viewBox='0 0 320 240'%3E%3Crect width='320' height='240' fill='%2334495e'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-family='system-ui' font-size='24' fill='%2395a5a6'%3EImage%3C/text%3E%3C/svg%3E";

/**
 * Resolve an asset `src`. Absolute URLs (http/https/data/blob/file) and
 * protocol-relative URLs pass through unchanged; a relative path is joined to
 * `base` if provided (so saved projects can keep portable relative paths).
 *
 * Special handling:
 * - Empty string → transparent fallback (invisible but won't break layout)
 * - "__placeholder__" sentinel → bundled placeholder image
 */
export function resolveSrc(src: string, base?: string): string {
  if (!src) return FALLBACK_DATA_URI;

  // Sentinel value → bundled placeholder
  if (src === "__placeholder__") {
    return "app://placeholder.png";
  }

  // Absolute URLs pass through
  if (/^([a-z]+:)?\/\//i.test(src) || src.startsWith("data:")) return src;

  // Relative paths → join with base, encoding each segment
  if (!base) return src;

  // Split path into segments and encode each (handles spaces, special chars)
  const segments = src.split("/").map(encodeURIComponent);
  const encodedSrc = segments.join("/");

  return base.endsWith("/") ? base + encodedSrc : `${base}/${encodedSrc}`;
}

/**
 * Determines if a source path is a video based on file extension. Used
 * wherever a single string field does double duty for image and video
 * sources (Collection items, Scene background) instead of a separate
 * mediaType field — see ADR 0006.
 */
export function isVideoSrc(src: string): boolean {
  const ext = src.split(".").pop()?.toLowerCase();
  return ext === "mp4" || ext === "webm" || ext === "mov" || ext === "ogg";
}

/**
 * Renders a single scene element as an absolutely-positioned DOM node using
 * CSS transforms. This is the shared rendering primitive used by both the
 * Player and (later) the Editor canvas.
 *
 * Memoized to prevent unnecessary re-renders when parent updates but element props unchanged.
 */
export const ElementRenderer = React.memo(function ElementRenderer({ element, onTap, onHover, onHoverEnd, onPress, onRelease, assetBaseUrl, playing, onAudioRef, onVideoRef, onIncompatible, editorMode, resolveElement, activeLayerId = null, currentLayerId = null, dimmableLayerIds = null }: ElementRendererProps) {
  const { type, x, y, width, height, rotation, opacity, zIndex, props } =
    element;

  const visible = VisibilityManager.isVisible(element);
  const isInteractive = visible && element.interactions.some((i) => i.trigger === "tap");
  const isHoverable = visible && element.interactions.some((i) => i.trigger === "hover" || i.trigger === "hoverEnd");
  const isPressable = visible && element.interactions.some((i) => i.trigger === "press" || i.trigger === "release");

  const hasInteraction = isInteractive || isHoverable || isPressable;

  // Editor-only: dim invisible elements instead of fully hiding them, so they
  // stay visible/selectable while editing. Nothing to dim if opacity is
  // already 0 (a deliberate fully-transparent element). Outside the editor,
  // visible=false forces opacity to 0 unconditionally — this is the one place
  // that enforces it, so a running animation tween can't fight a `visible:
  // false` override back to non-zero (see ADR 0013).
  // Scoped to the selection's layer: an invisible element only dims while the
  // selection is in the same layer (both null == root/base layer). Selecting
  // into a different layer hides it fully again, same as outside the editor.
  // A "layer" element is its own boundary rather than a sibling at someone
  // else's level, so it uses selection *containment* (self-or-descendant)
  // instead of the "same nearest layer" sibling match leaves use — otherwise
  // an invisible layer would dim whenever any sibling at its own level is
  // selected (not actually inside it), and stay hidden when its own contents
  // are selected (since selecting into the layer changes ITS nearest-layer
  // context, not the layer element's own).
  const editorDim = editorMode && !visible && opacity > 0 &&
    (type === "layer" ? (dimmableLayerIds?.has(element.id) ?? false) : currentLayerId === activeLayerId);
  const renderOpacity = editorMode
    ? (visible ? opacity : (editorDim ? 0.4 : 0))
    : (visible ? opacity : 0);

  const baseStyle: React.CSSProperties = {
    position: "absolute",
    left: 0,
    top: 0,
    width,
    height,
    opacity: renderOpacity,
    zIndex,
    transform: `translate(${x}px, ${y}px) rotate(${rotation}deg)`,
    transformOrigin: "center center",
    cursor: isInteractive || isPressable ? "pointer" : "default",
    userSelect: "none",
    // Decorative elements in player mode must not block clicks on interactive
    // elements (collections, buttons) behind them in z-order. Set explicitly
    // both ways (not just the "none" case) — `pointer-events` is CSS-inherited,
    // so an interactive element left unset here would silently inherit "none"
    // from a non-interactive ancestor `layer` container (see the "layer" case
    // below, which sets its own pointer-events to "none" when it has no
    // interactions of its own).
    ...(!editorMode && { pointerEvents: hasInteraction ? "auto" : "none" }),
  };

  const handleClick = isInteractive ? () => onTap?.(element) : undefined;

  const handleMouseEnter = onHover && isHoverable
    ? (e: React.MouseEvent) => {
        e.stopPropagation();
        if (element.interactions.some((i) => i.trigger === "hover")) {
          onHover(element);
        }
      }
    : undefined;

  const handleMouseLeave = onHoverEnd && isHoverable
    ? (e: React.MouseEvent) => {
        e.stopPropagation();
        if (element.interactions.some((i) => i.trigger === "hoverEnd")) {
          onHoverEnd(element);
        }
      }
    : undefined;

  const handlePointerDown = onPress && isPressable
    ? (e: React.PointerEvent) => {
        e.stopPropagation();
        if (element.interactions.some((i) => i.trigger === "press")) {
          onPress(element);
        }
      }
    : undefined;

  const handlePointerUp = onRelease && isPressable
    ? (e: React.PointerEvent) => {
        e.stopPropagation();
        if (element.interactions.some((i) => i.trigger === "release")) {
          onRelease(element);
        }
      }
    : undefined;

  // A "layer" container becomes its own children's nearest-layer context;
  // any other container (e.g. "collection") passes its own context through.
  const childLayerId = type === "layer" ? element.id : currentLayerId;

  const children = element.children?.map((child) => {
    const resolvedChild = resolveElement ? resolveElement(child) : child;
    return (
      <ElementRenderer
        key={child.id}
        element={resolvedChild}
        onTap={onTap}
        onHover={onHover}
        onHoverEnd={onHoverEnd}
        onPress={onPress}
        onRelease={onRelease}
        assetBaseUrl={assetBaseUrl}
        playing={playing}
        editorMode={editorMode}
        onAudioRef={onAudioRef}
        onVideoRef={onVideoRef}
        onIncompatible={onIncompatible}
        resolveElement={resolveElement}
        activeLayerId={activeLayerId}
        currentLayerId={childLayerId}
        dimmableLayerIds={dimmableLayerIds}
      />
    );
  });

  switch (type) {
    case "rectangle":
      return (
        <div
          data-element-id={element.id}
          style={{
            ...baseStyle,
            backgroundColor: str(props.fill, "#3b82f6"),
            borderRadius: num(props.radius, 0),
            border: str(props.border, "none"),
          }}
          onClick={handleClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
        >
          {children}
        </div>
      );

    case "html": {
      const html = str(props.html, "");
      return (
        <div
          data-element-id={element.id}
          style={{ ...baseStyle, overflow: "hidden" }}
          onClick={handleClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
        >
          <iframe
            srcDoc={html}
            sandbox="allow-scripts"
            title={element.name ?? "HTML content"}
            style={{
              width: "100%",
              height: "100%",
              border: "none",
              // In the editor, the canvas-level hit-testing overlay owns
              // select/drag for this element's bounding box — the iframe
              // must not intercept pointer events itself, or it could
              // swallow a drag. In the Player, it needs real pointer events
              // so embedded buttons/links/forms work.
              pointerEvents: editorMode ? "none" : "auto",
            }}
          />
        </div>
      );
    }

    case "text": {
      // A binding targeting "text"/"label" can only write a plain string
      // (see ElementResolver.resolveBindings) — it never touches
      // `props.content`, so a bound live value must win over stale rich
      // content rather than being silently shadowed by it.
      const boundToText = element.bindings?.some((b) => {
        const key = b.targetProp.startsWith("props.") ? b.targetProp.slice(6) : b.targetProp;
        return key === "text" || key === "label";
      }) ?? false;
      return (
        <TextElement
          elementId={element.id}
          props={props}
          boundToText={boundToText}
          baseStyle={baseStyle}
          width={width}
          height={height}
          onClick={handleClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
        >
          {children}
        </TextElement>
      );
    }

    case "image": {
      const imageSrc = resolveSrc(str(props.src, ""), assetBaseUrl);
      const isReady = imageLoadQueue.useImageReady(imageSrc, zIndex ?? 0);
      const border = str(props.border, "none");
      const crop = props.crop as { left: number; top: number; right: number; bottom: number } | undefined;

      const imgEl = (
        <img
          data-element-id={crop ? undefined : element.id}
          src={isReady ? imageSrc : PLACEHOLDER_FALLBACK}
          alt={str(props.alt, "")}
          draggable={false}
          decoding="async"
          loading="lazy"
          style={
            crop
              ? {
                  position: "absolute",
                  left: `${(-crop.left / (1 - crop.left - crop.right)) * 100}%`,
                  top: `${(-crop.top / (1 - crop.top - crop.bottom)) * 100}%`,
                  width: `${(1 / (1 - crop.left - crop.right)) * 100}%`,
                  height: `${(1 / (1 - crop.top - crop.bottom)) * 100}%`,
                  objectFit: "fill",
                  transition: isReady ? "opacity 0.2s ease-in" : "none",
                }
              : {
                  ...baseStyle,
                  objectFit: str(props.fit, "cover") as React.CSSProperties["objectFit"],
                  border,
                  transition: isReady ? "opacity 0.2s ease-in" : "none",
                }
          }
          onClick={crop ? undefined : handleClick}
          onMouseEnter={crop ? undefined : handleMouseEnter}
          onMouseLeave={crop ? undefined : handleMouseLeave}
          onPointerDown={crop ? undefined : handlePointerDown}
          onPointerUp={crop ? undefined : handlePointerUp}
          onError={(e) => {
            // If bundled placeholder fails to load, fall back to embedded SVG
            const target = e.currentTarget;
            if (target.src.startsWith("app://placeholder")) {
              target.src = PLACEHOLDER_FALLBACK;
              console.warn("Bundled placeholder failed to load, using embedded SVG fallback");
            }
          }}
        />
      );

      if (!crop) return imgEl;

      // Cropped images need an overflow:hidden viewport at the element's own
      // box; the <img> inside is oversized/offset so only the cropped region
      // shows through, so interaction handlers live on the wrapper instead.
      return (
        <div
          data-element-id={element.id}
          style={{ ...baseStyle, overflow: "hidden", border }}
          onClick={handleClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
        >
          {imgEl}
        </div>
      );
    }

    case "table": {
      const colWidths = (props.colWidths as number[] | undefined) ?? [];
      const rowHeights = (props.rowHeights as number[] | undefined) ?? [];
      const cells = (props.cells as ({ text: string; fill?: string; color?: string; bold?: boolean; align?: "left" | "center" | "right"; colSpan?: number; rowSpan?: number } | null)[][] | undefined) ?? [];
      const cellBorder = `${num(props.borderWidth, 1)}px solid ${str(props.borderColor, "#94a3b8")}`;

      return (
        <div
          data-element-id={element.id}
          style={{
            ...baseStyle,
            display: "grid",
            gridTemplateColumns: colWidths.map((w) => `${w}px`).join(" "),
            gridTemplateRows: rowHeights.map((h) => `${h}px`).join(" "),
          }}
          onClick={handleClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
        >
          {cells.map((row, r) =>
            row.map((cell, c) => {
              if (!cell) return null;
              return (
                <div
                  key={`${r}-${c}`}
                  style={{
                    gridColumn: `${c + 1} / span ${cell.colSpan ?? 1}`,
                    gridRow: `${r + 1} / span ${cell.rowSpan ?? 1}`,
                    background: cell.fill ?? "transparent",
                    color: cell.color ?? "#0f172a",
                    fontWeight: cell.bold ? "700" : "normal",
                    textAlign: cell.align ?? "left",
                    border: cellBorder,
                    padding: "4px 8px",
                    overflow: "hidden",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {cell.text}
                </div>
              );
            })
          )}
        </div>
      );
    }

    case "line": {
      const x1 = num(props.x1, 0) * width;
      const y1 = num(props.y1, 0) * height;
      const x2 = num(props.x2, 1) * width;
      const y2 = num(props.y2, 1) * height;
      const strokeColor = str(props.strokeColor, "#0f172a");
      const strokeWidth = num(props.strokeWidth, 2);
      const startArrow = str(props.startArrow, "none") === "triangle";
      const endArrow = str(props.endArrow, "none") === "triangle";
      const dash = str(props.dash, "solid");
      const strokeDasharray = dash === "dash" ? `${strokeWidth * 3},${strokeWidth * 2}` : dash === "dot" ? `${strokeWidth},${strokeWidth * 2}` : undefined;
      const markerId = `arrow-${element.id}`;
      // A perfectly horizontal/vertical connector has a zero-width or
      // zero-height box — but per the SVG spec, width=0 or height=0 on the
      // <svg> element disables rendering of its ENTIRE subtree, regardless of
      // overflow:visible. Clamp just the viewport (not the line's own x1/y1/
      // x2/y2 math above, which still uses the true width/height) so the box
      // itself stays a valid non-zero rendering surface.
      const svgWidth = Math.max(width, 1);
      const svgHeight = Math.max(height, 1);

      return (
        <svg
          data-element-id={element.id}
          width={svgWidth}
          height={svgHeight}
          style={{ ...baseStyle, width: svgWidth, height: svgHeight, overflow: "visible" }}
          onClick={handleClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
        >
          {(startArrow || endArrow) && (
            <defs>
              <marker id={`${markerId}-start`} markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto-start-reverse">
                <path d="M0,0 L8,4 L0,8 Z" fill={strokeColor} />
              </marker>
              <marker id={`${markerId}-end`} markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8 Z" fill={strokeColor} />
              </marker>
            </defs>
          )}
          <line
            x1={x1} y1={y1} x2={x2} y2={y2}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeDasharray={strokeDasharray}
            markerStart={startArrow ? `url(#${markerId}-start)` : undefined}
            markerEnd={endArrow ? `url(#${markerId}-end)` : undefined}
          />
        </svg>
      );
    }

    case "video":
      return (
        <VideoElement
          element={element}
          assetBaseUrl={assetBaseUrl}
          playing={playing}
          onVideoRef={onVideoRef}
          onIncompatible={onIncompatible}
          baseStyle={baseStyle}
          hasInteraction={hasInteraction}
          onClick={handleClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
        />
      );

    case "audio":
      return (
        <AudioElement
          element={element}
          baseStyle={baseStyle}
          assetBaseUrl={assetBaseUrl}
          playing={playing}
          onTap={() => onTap?.(element)}
          onAudioRef={onAudioRef}
        />
      );

    case "button": {
      const fillType = str(props.fillType, "color");
      const imageSrc = resolveSrc(str(props.imageSrc, ""), assetBaseUrl);
      const imageFit = str(props.imageFit, "cover") as React.CSSProperties["objectFit"];
      const radius = num(props.radius, 12);
      const isButtonImageReady = imageLoadQueue.useImageReady(imageSrc, zIndex ?? 0);

      return (
        <>
          {/* Visual button element at its normal z-index */}
          <div
            data-element-id={element.id}
            role="button"
            style={{
              ...baseStyle,
              backgroundColor: fillType === "color" ? str(props.fill, "#2563eb") : "transparent",
              color: str(props.color, "#ffffff"),
              borderRadius: radius,
              fontSize: num(props.fontSize, 28),
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              pointerEvents: editorMode ? "none" : "none", // Disable events on visual element
              overflow: "hidden",
            }}
          >
            {/* Image fill background */}
            {fillType === "image" && (
              <img
                src={isButtonImageReady ? imageSrc : PLACEHOLDER_FALLBACK}
                alt=""
                draggable={false}
                decoding="async"
                loading="lazy"
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  objectFit: imageFit,
                  pointerEvents: "none",
                  zIndex: 0,
                  transition: isButtonImageReady ? "opacity 0.2s ease-in" : "none",
                }}
                onError={(e) => {
                  const target = e.currentTarget;
                  if (target.src.startsWith("app://placeholder")) {
                    target.src = PLACEHOLDER_FALLBACK;
                  }
                }}
              />
            )}
            {/* Label text */}
            <span style={{ position: "relative", zIndex: 1 }}>
              {str(props.label, "Button")}
            </span>
            {children}
          </div>
          {/* Invisible interaction overlay at high z-index (only in player mode) */}
          {!editorMode && visible && (
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width,
                height,
                transform: `translate(${x}px, ${y}px) rotate(${rotation}deg)`,
                transformOrigin: "top left",
                zIndex: 999999, // Very high z-index to capture events above everything
                borderRadius: radius, // Match visual button's shape
                cursor: "pointer",
                pointerEvents: "auto",
              }}
              onClick={() => onTap?.(element)}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
              onPointerDown={handlePointerDown}
              onPointerUp={handlePointerUp}
            />
          )}
        </>
      );
    }

    case "layer": {
      const { tint, mask } = element;

      // Build inline SVG clipPath if mask exists
      let clipPathStyle: string | undefined;
      if (mask) {
        let pathData: string;
        if (mask.type === 'rect') {
          const x1 = mask.points[0][0];
          const y1 = mask.points[0][1];
          const w = mask.points[1][0] - x1;
          const h = mask.points[1][1] - y1;
          pathData = `M ${x1} ${y1} L ${x1 + w} ${y1} L ${x1 + w} ${y1 + h} L ${x1} ${y1 + h} Z`;
        } else {
          pathData = `M ${mask.points.map((p, i) => (i === 0 ? `${p[0]} ${p[1]}` : `L ${p[0]} ${p[1]}`)).join(' ')} Z`;
        }
        const svgPath = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><path d="${pathData}" fill="white"/></svg>`)}`;
        clipPathStyle = `url("${svgPath}")`;
      }

      return (
        <div
          data-element-id={element.id}
          style={{
            ...baseStyle,
            // Layer is a full-scene container div. Without this, the layer div
            // (which spans the whole scene) silently swallows pointer events for
            // every layer below it in z-order, blocking buttons and interactions.
            // Children with pointer-events: auto (the default) still receive events.
            // Only opt back into auto if the layer itself has defined interactions.
            pointerEvents: isInteractive || isHoverable || isPressable ? "auto" : "none",
            // When a layer is fully hidden (opacity 0, whether from its own base
            // opacity or a visible:false override), visibility:hidden ensures
            // children inherit the hidden state and stop absorbing pointer events.
            // pointer-events:none on the container alone does NOT prevent children
            // with explicit pointer-events:auto from blocking elements behind them.
            ...(!editorMode && renderOpacity === 0 && { visibility: "hidden" as const }),
            WebkitMaskImage: clipPathStyle,
            maskImage: clipPathStyle,
            WebkitMaskSize: `${width}px ${height}px`,
            maskSize: `${width}px ${height}px`,
            WebkitMaskRepeat: 'no-repeat',
            maskRepeat: 'no-repeat',
          }}
          onClick={handleClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
        >
          {children}
          {tint && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                backgroundColor: tint.color,
                opacity: tint.opacity,
                pointerEvents: 'none',
              }}
            />
          )}
        </div>
      );
    }

    case "collection":
      return (
        <div
          data-element-id={element.id}
          style={{
            ...baseStyle,
            overflow: "hidden",
            // Outside the editor, an invisible collection must not intercept
            // clicks meant for elements below it. Editor mode keeps it
            // selectable (matches editorDim's "stay clickable while dimmed").
            pointerEvents: !editorMode && !visible ? "none" : "auto",
          }}
          onClick={handleClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
        >
          <CollectionRenderer
            width={width}
            height={height}
            props={props}
            assetBaseUrl={assetBaseUrl}
            playing={playing}
            interactive={visible}
          />
        </div>
      );

    default:
      return null;
  }
}, (prevProps, nextProps) => {
  // Custom comparison: only re-render if element or key props actually changed
  // This prevents cascading re-renders when parent state updates but element unchanged
  return (
    prevProps.element === nextProps.element &&
    prevProps.playing === nextProps.playing &&
    prevProps.assetBaseUrl === nextProps.assetBaseUrl &&
    prevProps.editorMode === nextProps.editorMode &&
    prevProps.activeLayerId === nextProps.activeLayerId &&
    prevProps.currentLayerId === nextProps.currentLayerId &&
    prevProps.dimmableLayerIds === nextProps.dimmableLayerIds &&
    prevProps.onTap === nextProps.onTap &&
    prevProps.onHover === nextProps.onHover &&
    prevProps.onHoverEnd === nextProps.onHoverEnd &&
    prevProps.onPress === nextProps.onPress &&
    prevProps.onRelease === nextProps.onRelease
  );
});

// --- audio element with fade-in/out ----------------------------------------

interface AudioElementProps {
  element: Element;
  baseStyle: React.CSSProperties;
  assetBaseUrl?: string;
  playing?: boolean;
  onTap: () => void;
  onAudioRef?: (elementId: string, ref: HTMLAudioElement | null) => void;
}

function AudioElement({ element, baseStyle, assetBaseUrl, playing, onTap, onAudioRef }: AudioElementProps) {
  const audioRef = React.useRef<HTMLAudioElement>(null);
  const fadeTimeoutRef = React.useRef<ReturnType<typeof setTimeout>>();
  const fadeAnimationRef = React.useRef<number>();
  const maxFadeDurationMs = React.useRef(0);
  const currentVolumeRef = React.useRef(1);

  const props = element.props;
  const src = resolveSrc(str(props.src, ""), assetBaseUrl);
  const volume = num(props.volume, 1);
  const fadeMs = Math.max(0, num(props.fade, 0));
  const autoplay = bool(props.autoplay, false);
  const loop = bool(props.loop, false);
  const muted = bool(props.muted, false);

  // Setup fade-in on play
  const handlePlay = () => {
    // Emit audioPlay event
    eventBus.emit({
      kind: "audioPlay",
      payload: { elementId: element.id, currentTime: audioRef.current?.currentTime ?? 0 }
    });

    if (audioRef.current && fadeMs > 0) {
      cancelAnimationFrame(fadeAnimationRef.current ?? 0);
      clearTimeout(fadeTimeoutRef.current);

      // Calculate max fade duration based on audio duration (in milliseconds)
      const durationMs = (audioRef.current.duration || 0) * 1000;
      maxFadeDurationMs.current = Math.min(Math.max(durationMs / 2, 0), 5000);
      const clampedFadeMs = Math.min(fadeMs, maxFadeDurationMs.current);

      // Fade in
      currentVolumeRef.current = 0;
      audioRef.current.volume = 0;
      const startTime = Date.now();

      const fadeInFrame = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / clampedFadeMs, 1);
        if (audioRef.current) {
          currentVolumeRef.current = volume * progress;
          audioRef.current.volume = currentVolumeRef.current;
        }
        if (progress < 1) {
          fadeAnimationRef.current = requestAnimationFrame(fadeInFrame);
        } else {
          // Schedule fade-out
          if (durationMs > 0 && clampedFadeMs > 0) {
            const fadeOutDelayMs = durationMs - clampedFadeMs;
            fadeTimeoutRef.current = setTimeout(() => {
              scheduleFadeOut(clampedFadeMs);
            }, fadeOutDelayMs);
          }
        }
      };
      fadeAnimationRef.current = requestAnimationFrame(fadeInFrame);
    }
  };

  const scheduleFadeOut = (fadeDurationMs: number) => {
    if (!audioRef.current) return;
    cancelAnimationFrame(fadeAnimationRef.current ?? 0);

    const startVolume = audioRef.current.volume;
    const startTime = Date.now();

    const fadeOutFrame = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / fadeDurationMs, 1);
      if (audioRef.current) {
        currentVolumeRef.current = startVolume * (1 - progress);
        audioRef.current.volume = Math.max(currentVolumeRef.current, 0);
      }
      if (progress < 1) {
        fadeAnimationRef.current = requestAnimationFrame(fadeOutFrame);
      }
    };
    fadeAnimationRef.current = requestAnimationFrame(fadeOutFrame);
  };

  const handleCanPlay = () => {
    if (audioRef.current) {
      const durationMs = (audioRef.current.duration || 0) * 1000;
      maxFadeDurationMs.current = Math.min(Math.max(durationMs / 2, 0), 5000);
      const clampedFadeMs = Math.min(fadeMs, maxFadeDurationMs.current);

      // If audio is already playing, schedule fade-out
      if (!audioRef.current.paused && clampedFadeMs > 0 && durationMs > 0) {
        const currentTimeMs = audioRef.current.currentTime * 1000;
        const timeUntilEndMs = durationMs - currentTimeMs;
        const fadeOutStartMs = timeUntilEndMs - clampedFadeMs;

        if (fadeOutStartMs > 0) {
          clearTimeout(fadeTimeoutRef.current);
          fadeTimeoutRef.current = setTimeout(() => {
            scheduleFadeOut(clampedFadeMs);
          }, Math.max(fadeOutStartMs, 0));
        }
      }
    }
  };

  const handlePause = () => {
    // Emit audioPause event
    eventBus.emit({
      kind: "audioPause",
      payload: { elementId: element.id, currentTime: audioRef.current?.currentTime ?? 0 }
    });
  };

  const handleEnded = () => {
    // Emit audioComplete event
    eventBus.emit({
      kind: "audioComplete",
      payload: { elementId: element.id, duration: audioRef.current?.duration ?? 0 }
    });

    cancelAnimationFrame(fadeAnimationRef.current ?? 0);
    clearTimeout(fadeTimeoutRef.current);
  };

  React.useEffect(() => {
    return () => {
      cancelAnimationFrame(fadeAnimationRef.current ?? 0);
      clearTimeout(fadeTimeoutRef.current);
    };
  }, []);

  // Set initial volume after render
  React.useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
      currentVolumeRef.current = volume;
    }
  }, [volume]);

  React.useEffect(() => {
    onAudioRef?.(element.id, audioRef.current);
    return () => {
      onAudioRef?.(element.id, null);
    };
  }, [element.id, onAudioRef]);

  // Embedded audio icon (speaker with sound waves) - base64 encoded SVG
  const AUDIO_ICON = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiM5NGEzYjgiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cG9seWdvbiBwb2ludHM9IjExIDUgNiA5IDIgOSAyIDE1IDYgMTUgMTEgMTkgMTEgNSI+PC9wb2x5Z29uPjxwYXRoIGQ9Ik0xNS41NCA4LjQ2YTUgNSAwIDAgMSAwIDcuMDciPjwvcGF0aD48cGF0aCBkPSJNMTkuMDcgNC45M2ExMCAxMCAwIDAgMSAwIDE0LjE0Ij48L3BhdGg+PC9zdmc+";

  return (
    <div
      data-element-id={element.id}
      style={{
        ...baseStyle,
        border: "1px solid #64748b",
        borderRadius: 4,
        backgroundColor: "#1e293b",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        overflow: "hidden",
      }}
      onClick={onTap}
    >
      {/* Background icon image */}
      <img
        src={AUDIO_ICON}
        alt="Audio"
        draggable={false}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          opacity: 0.6,
          pointerEvents: "none",
        }}
      />
      {/* Hidden audio element for playback */}
      <audio
        ref={audioRef}
        src={src}
        autoPlay={autoplay && playing}
        loop={loop}
        muted={muted}
        onPlay={handlePlay}
        onPause={handlePause}
        onCanPlay={handleCanPlay}
        onEnded={handleEnded}
        onError={() => console.warn(`Failed to load audio: ${src}`)}
        style={{ display: "none" }}
      />
    </div>
  );
}

// --- video element ------------------------------------------------------

interface VideoElementProps {
  element: Element;
  assetBaseUrl?: string;
  playing?: boolean;
  onVideoRef?: (elementId: string, ref: HTMLVideoElement | null) => void;
  /** Fired when the <video> reports a DECODE (3) or SRC_NOT_SUPPORTED (4) error — an
   * unplayable codec rather than a transient network/abort issue. Unused by default, so
   * the exported/deployed Player (no ffmpeg available outside Electron) is unaffected. */
  onIncompatible?: (elementId: string, src: string) => void;
  baseStyle: React.CSSProperties;
  hasInteraction?: boolean;
  onClick?: () => void;
  onMouseEnter?: (e: React.MouseEvent) => void;
  onMouseLeave?: (e: React.MouseEvent) => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  onPointerUp?: (e: React.PointerEvent) => void;
}

/**
 * Native HTML5 video element with programmatic control.
 * Supports standard video formats (mp4, webm, mov, ogg).
 */
function VideoElement({ element, assetBaseUrl, playing, onVideoRef, onIncompatible, baseStyle, hasInteraction, onClick, onMouseEnter, onMouseLeave, onPointerDown, onPointerUp }: VideoElementProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hasError, setHasError] = useState(false);
  const [shouldLoad, setShouldLoad] = useState(false);
  // Tracks the same node as videoRef, but as state — a prop read from
  // videoRef.current would still see the pre-mount value on the render that
  // introduces the <video> tag, since refs attach during commit.
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const { props } = element;

  const src = resolveSrc(str(props.src, ""), assetBaseUrl);
  const rawSrc = str(props.src, "");
  const hasSource = rawSrc && rawSrc.trim() !== "";

  // Lazy-load video when in viewport (with margin for preloading just before scroll)
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !hasSource) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setShouldLoad(true);
            observer.disconnect(); // Load once, never unload
          }
        });
      },
      { root: null, rootMargin: "200px" } // root: null = observe relative to viewport
    );

    // Fallback: force load after 2s if observer never fires (e.g., scaled viewport issues)
    const timeout = setTimeout(() => setShouldLoad(true), 2000);

    observer.observe(container);
    return () => {
      clearTimeout(timeout);
      observer.disconnect();
    };
  }, [hasSource]);

  // Register video ref with Player and setup event listeners. Depends on
  // `videoEl` state (not videoRef.current) — the <video> tag mounts lazily
  // once `shouldLoad` flips true, so a ref read on mount would register null
  // and never re-fire once the real node exists.
  useEffect(() => {
    const video = videoEl;
    onVideoRef?.(element.id, video);

    if (!video) return;

    // Event listeners for analytics
    const onPlay = () => {
      eventBus.emit({
        kind: "videoPlay",
        payload: { elementId: element.id, currentTime: video.currentTime }
      });
    };

    const onPause = () => {
      eventBus.emit({
        kind: "videoPause",
        payload: { elementId: element.id, currentTime: video.currentTime }
      });
    };

    const onEnded = () => {
      eventBus.emit({
        kind: "videoComplete",
        payload: { elementId: element.id, duration: video.duration }
      });
    };

    const onSeeked = () => {
      eventBus.emit({
        kind: "videoSeek",
        payload: { elementId: element.id, currentTime: video.currentTime }
      });
    };

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    video.addEventListener("seeked", onSeeked);

    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("seeked", onSeeked);
      onVideoRef?.(element.id, null);
    };
  }, [element.id, onVideoRef, videoEl]);

  // Apply props.playbackRate (the Properties panel "Speed" field, or a
  // "Set property" interaction targeting it) to the actual element. Not a
  // JSX-settable HTML attribute like autoplay/loop/muted, so it needs an
  // imperative assignment — same as the runtime `setSpeed` interaction
  // action does (Player.tsx), just driven by the prop instead of an event.
  useEffect(() => {
    if (videoEl) videoEl.playbackRate = num(props.playbackRate, 1);
  }, [videoEl, props.playbackRate]);

  // Handle autoplay when playing prop changes
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playing || !bool(props.autoplay, true) || !hasSource) return;

    const tryPlay = () => {
      video.play().catch((err) => {
        console.warn(`[VideoElement ${element.id}] Autoplay blocked:`, err);
      });
    };

    // If video already loaded enough data, play immediately
    if (video.readyState >= 3) {
      tryPlay();
    } else {
      // Otherwise wait for canplaythrough event
      video.addEventListener("canplaythrough", tryPlay, { once: true });
      return () => video.removeEventListener("canplaythrough", tryPlay);
    }
  }, [element.id, playing, props.autoplay, hasSource, src]);

  const showControls = bool(props.showControls, false);
  const isVisible = Number(baseStyle.opacity ?? 1) > 0;
  return (
    <div
      ref={containerRef}
      data-element-id={element.id}
      style={{ ...baseStyle, pointerEvents: isVisible && (showControls || hasInteraction) ? "auto" : "none" }}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      {hasSource && shouldLoad && (
        <video
          ref={(el) => {
            videoRef.current = el;
            setVideoEl(el);
          }}
          src={src}
          autoPlay={bool(props.autoplay, true) && playing}
          loop={bool(props.loop, true)}
          muted={bool(props.muted, true)}
          playsInline
          preload={str(props.preload, "metadata") as "auto" | "metadata" | "none"}
          onError={(e) => {
            const video = e.currentTarget;
            const errorCode = video.error?.code;
            const errorMsg = video.error?.message;
            console.error(`[VideoElement ${element.id}] Load error:`, {
              src: rawSrc,
              resolvedSrc: src,
              errorCode,
              errorMsg,
              codes: { 1: "ABORTED", 2: "NETWORK", 3: "DECODE", 4: "SRC_NOT_SUPPORTED" },
            });
            setHasError(true);
            if (errorCode === 3 || errorCode === 4) onIncompatible?.(element.id, rawSrc);
          }}
          onLoadStart={() => setHasError(false)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: str(props.fit, "cover") as React.CSSProperties["objectFit"],
          }}
        />
      )}
      {hasSource && shouldLoad && playing && bool(props.showControls, false) && (
        <VideoControls video={videoEl} />
      )}
      {!hasSource && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#1e293b",
            color: "#64748b",
            fontSize: 24,
            fontFamily: "system-ui, sans-serif",
            pointerEvents: "none",
          }}
        >
          🎬 No video source
        </div>
      )}
      {hasError && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#1e293b",
            color: "#64748b",
            fontSize: 24,
            fontFamily: "system-ui, sans-serif",
            pointerEvents: "none",
          }}
        >
          ⚠️ Video failed to load
        </div>
      )}
    </div>
  );
}

// --- text element (per-character rich text + autofit) ----------------------

// Exported so RichTextEditor.tsx's live editing overlay can match this
// exactly — including the blank-paragraph compression below — instead of
// drifting from whatever the browser's default line-height happens to be.
export const TEXT_LINE_HEIGHT = 1.15; // tight, close to PowerPoint's default
const LINE_HEIGHT = TEXT_LINE_HEIGHT;
const LIST_INDENT_PX = 28;

/**
 * A text box. Renders `props.content` (a `RichTextDoc`: paragraphs of spans,
 * each span carrying its own bold/italic/underline/color, each paragraph
 * carrying optional align/fontSize/list) with a fallback to the single
 * box-level style. Mirrors PowerPoint's normAutofit by MEASURING the rendered
 * content and shrinking the font uniformly until it fits the box height
 * (PowerPoint computes that shrink live, so the stored fontScale is usually
 * absent and we can't trust it).
 */
function TextElement({
  elementId,
  props,
  boundToText,
  baseStyle,
  width,
  height,
  onClick,
  onMouseEnter,
  onMouseLeave,
  onPointerDown,
  onPointerUp,
  children,
}: {
  elementId: string;
  props: Record<string, unknown>;
  boundToText: boolean;
  baseStyle: React.CSSProperties;
  width: number;
  height: number;
  onClick?: () => void;
  onMouseEnter?: (e: React.MouseEvent) => void;
  onMouseLeave?: (e: React.MouseEvent) => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  onPointerUp?: (e: React.PointerEvent) => void;
  children?: React.ReactNode;
}) {
  const align = str(props.align, "left") as "left" | "center" | "right";
  const justify = align === "right" ? "flex-end" : align === "center" ? "center" : "flex-start";
  const baseColor = str(props.color, "#ffffff");
  const baseFontSize = num(props.fontSize, 32);
  const baseWeight = str(props.fontWeight, "normal");
  const baseFontStyle = str(props.fontStyle, "normal");
  const baseTextDecoration = str(props.textDecoration, "none");

  const innerRef = React.useRef<HTMLDivElement>(null);
  const [fit, setFit] = React.useState(1);

  // After layout, measure the content vs the box and shrink to fit. Re-run when
  // anything affecting layout changes. Reset to 1 first so growth (e.g. box
  // resized larger in the editor) is re-measured from full size.
  React.useLayoutEffect(() => {
    setFit(1);
  }, [width, height, baseFontSize, props.content, props.text, boundToText]);

  React.useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el || height <= 0) return;
    // scrollHeight is the unclipped content height at the current fit.
    const content = el.scrollHeight;
    const budget = height * 0.98; // small bottom margin so descenders survive
    if (content > budget && fit > 0.4) {
      const next = Math.max(0.4, fit * (budget / content));
      // Avoid thrashing on sub-pixel differences.
      if (next < fit - 0.005) setFit(next);
    }
  });

  // A binding writing to props.text/label overrides any (possibly stale)
  // rich content — see the `boundToText` comment at the call site.
  const doc: RichTextDoc = boundToText
    ? plainTextToRichTextDoc(str(props.text, ""))
    : parseContent(props.content) ?? plainTextToRichTextDoc(str(props.text, ""));

  const numberCounters: number[] = [];

  return (
    <div
      data-element-id={elementId}
      style={{
        ...baseStyle,
        color: baseColor,
        fontWeight: baseWeight,
        fontStyle: baseFontStyle,
        textDecoration: baseTextDecoration,
        fontFamily: str(props.fontFamily, "system-ui, sans-serif"),
        // Same props.fill/props.border convention as the rectangle element.
        backgroundColor: str(props.fill, "transparent"),
        border: str(props.border, "none"),
        // Column flex: alignItems honors horizontal alignment; top-anchored
        // (flex-start) to match PowerPoint's default text-box anchoring and
        // keep multi-line bodies reading from the top.
        display: "flex",
        flexDirection: "column",
        alignItems: justify,
        justifyContent: "flex-start",
        textAlign: align as React.CSSProperties["textAlign"],
        whiteSpace: "pre-wrap",
        overflow: "hidden",
      }}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      <div ref={innerRef} style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: justify }}>
        {doc.paragraphs.map((p, i) => {
          const blank = p.spans.length === 0 || !p.spans.some((s) => s.text.trim());
          const paragraphAlign = (p.align ?? align) as React.CSSProperties["textAlign"];
          const fontSize = (p.fontSize ?? baseFontSize) * fit;

          if (p.list) {
            const level = Math.max(0, p.list.level);
            if (p.list.kind === "number") {
              numberCounters[level] = (numberCounters[level] ?? 0) + 1;
              numberCounters.length = level + 1; // deeper levels restart under a new item
            } else {
              numberCounters.length = 0;
            }
            const marker = p.list.kind === "number" ? `${numberCounters[level]}.` : "•";
            return (
              <div
                key={i}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                  paddingLeft: level * LIST_INDENT_PX,
                  lineHeight: LINE_HEIGHT,
                  textAlign: paragraphAlign,
                }}
              >
                <span style={{ flexShrink: 0, fontSize, color: baseColor }}>{marker}</span>
                <span style={{ flex: 1 }}>{renderSpans(p.spans, fontSize, baseColor, baseWeight, baseFontStyle, baseTextDecoration)}</span>
              </div>
            );
          }

          numberCounters.length = 0;
          return (
            <div
              key={i}
              style={{
                width: "100%",
                // Blank paragraphs are spacing — render at half height so a run
                // of them doesn't push content off the box.
                lineHeight: blank ? 0.5 : LINE_HEIGHT,
                textAlign: paragraphAlign,
                paddingLeft: (p.indent ?? 0) * LIST_INDENT_PX,
              }}
            >
              {blank ? " " : renderSpans(p.spans, fontSize, baseColor, baseWeight, baseFontStyle, baseTextDecoration)}
            </div>
          );
        })}
      </div>
      {children}
    </div>
  );
}

function renderSpans(
  spans: RichTextDoc["paragraphs"][number]["spans"],
  fontSize: number,
  baseColor: string,
  baseWeight: string,
  baseFontStyle: string,
  baseTextDecoration: string,
): React.ReactNode {
  return spans.map((s, i) => (
    <span
      key={i}
      style={{
        fontSize,
        color: s.color ?? baseColor,
        fontWeight: s.bold ? "bold" : baseWeight,
        fontStyle: s.italic ? "italic" : baseFontStyle,
        textDecoration: s.underline ? "underline" : baseTextDecoration,
      }}
    >
      {s.text || (spans.length === 1 ? " " : "")}
    </span>
  ));
}

/** Validates `props.content` as a `RichTextDoc`, or null if absent/malformed. */
function parseContent(v: unknown): RichTextDoc | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (o.version === 1 && Array.isArray(o.paragraphs)) return o as unknown as RichTextDoc;
  }
  warnBadProp("RichTextDoc", v);
  return null;
}


// --- small prop coercion helpers (props are Record<string, unknown>) -------

/**
 * Warn only when a prop was actually SET to something of the wrong type or
 * shape — not when it was simply omitted (omission is normal; every element
 * type has optional props). Omission silently falling back is fine; a
 * present-but-malformed value silently falling back is how a broken import
 * or a bad upstream write masquerades as "missing content" with no trail.
 */
function warnBadProp(expected: string, v: unknown): void {
  console.warn(`[ElementRenderer] expected ${expected}, got`, v, "— using fallback.");
}
function str(v: unknown, fallback: string): string {
  if (typeof v === "string") return v;
  if (v !== undefined && v !== null) warnBadProp("string", v);
  return fallback;
}
function num(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v !== undefined && v !== null) warnBadProp("finite number", v);
  return fallback;
}
function bool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (v !== undefined && v !== null) warnBadProp("boolean", v);
  return fallback;
}
