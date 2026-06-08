import React from "react";
import type { Element } from "../model/types.js";
import { CollectionRenderer } from "./collections/CollectionRenderer.js";

export interface ElementRendererProps {
  element: Element;
  /** Fired when an element with a `tap` interaction is activated. */
  onTap?: (element: Element) => void;
  /**
   * Base URL for resolving relative asset `src` values (e.g. "assets/x.png").
   * Typically a `file://<projectDir>/` URL. Absolute URLs pass through.
   */
  assetBaseUrl?: string;
  /** True in the Player; enables time-based behavior (e.g. Ken Burns auto-advance). */
  playing?: boolean;
}

/**
 * Resolve an asset `src`. Absolute URLs (http/https/data/blob/file) and
 * protocol-relative URLs pass through unchanged; a relative path is joined to
 * `base` if provided (so saved projects can keep portable relative paths).
 */
export function resolveSrc(src: string, base?: string): string {
  if (!src) return src;
  if (/^([a-z]+:)?\/\//i.test(src) || src.startsWith("data:")) return src;
  if (!base) return src;
  return base.endsWith("/") ? base + src : `${base}/${src}`;
}

/**
 * Renders a single scene element as an absolutely-positioned DOM node using
 * CSS transforms. This is the shared rendering primitive used by both the
 * Player and (later) the Editor canvas.
 */
export function ElementRenderer({ element, onTap, assetBaseUrl, playing }: ElementRendererProps) {
  const { type, x, y, width, height, rotation, opacity, zIndex, props } =
    element;

  const isInteractive = element.interactions.some((i) => i.trigger === "tap");

  const baseStyle: React.CSSProperties = {
    position: "absolute",
    left: 0,
    top: 0,
    width,
    height,
    opacity,
    zIndex,
    transform: `translate(${x}px, ${y}px) rotate(${rotation}deg)`,
    transformOrigin: "center center",
    cursor: isInteractive ? "pointer" : "default",
    userSelect: "none",
  };

  const handleClick = isInteractive ? () => onTap?.(element) : undefined;

  const children = element.children?.map((child) => (
    <ElementRenderer key={child.id} element={child} onTap={onTap} assetBaseUrl={assetBaseUrl} playing={playing} />
  ));

  switch (type) {
    case "rectangle":
      return (
        <div
          style={{
            ...baseStyle,
            backgroundColor: str(props.fill, "#3b82f6"),
            borderRadius: num(props.radius, 0),
            border: str(props.border, "none"),
          }}
          onClick={handleClick}
        >
          {children}
        </div>
      );

    case "text":
      return (
        <TextElement props={props} baseStyle={baseStyle} width={width} height={height} onClick={handleClick}>
          {children}
        </TextElement>
      );

    case "image":
      return (
        <img
          src={resolveSrc(str(props.src, ""), assetBaseUrl)}
          alt={str(props.alt, "")}
          draggable={false}
          style={{
            ...baseStyle,
            objectFit: str(props.fit, "cover") as React.CSSProperties["objectFit"],
          }}
          onClick={handleClick}
        />
      );

    case "video":
      return (
        <video
          src={resolveSrc(str(props.src, ""), assetBaseUrl)}
          autoPlay={bool(props.autoplay, true)}
          loop={bool(props.loop, true)}
          muted={bool(props.muted, true)}
          playsInline
          style={{
            ...baseStyle,
            objectFit: str(props.fit, "cover") as React.CSSProperties["objectFit"],
          }}
          onClick={handleClick}
        />
      );

    case "button":
      return (
        <div
          role="button"
          style={{
            ...baseStyle,
            backgroundColor: str(props.fill, "#2563eb"),
            color: str(props.color, "#ffffff"),
            borderRadius: num(props.radius, 12),
            fontSize: num(props.fontSize, 28),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
          onClick={() => onTap?.(element)}
        >
          {str(props.label, "Button")}
          {children}
        </div>
      );

    case "group":
      return (
        <div style={baseStyle} onClick={handleClick}>
          {children}
        </div>
      );

    case "collection":
      return (
        <div style={{ ...baseStyle, overflow: "hidden" }} onClick={handleClick}>
          <CollectionRenderer
            width={width}
            height={height}
            props={props}
            assetBaseUrl={assetBaseUrl}
            playing={playing}
          />
        </div>
      );

    default:
      return null;
  }
}

// --- text element (per-line rich text + autofit) ----------------------------

interface TextRun {
  text: string;
  fontSize?: number;
  color?: string;
  fontWeight?: string;
  fontStyle?: string;
  align?: "left" | "center" | "right";
}

const LINE_HEIGHT = 1.15; // tight, close to PowerPoint's default

/**
 * A text box. Supports per-line rich text (`props.runs`: each line carries its
 * own weight/size/color, so a box can have bold top-level bullets and non-bold
 * sub-bullets) with a fallback to the single box-level style. Mirrors
 * PowerPoint's normAutofit by MEASURING the rendered content and shrinking the
 * font uniformly until it fits the box height (PowerPoint computes that shrink
 * live, so the stored fontScale is usually absent and we can't trust it).
 */
function TextElement({
  props,
  baseStyle,
  width,
  height,
  onClick,
  children,
}: {
  props: Record<string, unknown>;
  baseStyle: React.CSSProperties;
  width: number;
  height: number;
  onClick?: () => void;
  children?: React.ReactNode;
}) {
  const align = str(props.align, "left") as "left" | "center" | "right";
  const justify = align === "right" ? "flex-end" : align === "center" ? "center" : "flex-start";
  const baseColor = str(props.color, "#ffffff");
  const baseFontSize = num(props.fontSize, 32);
  const baseWeight = str(props.fontWeight, "normal");
  const baseFontStyle = str(props.fontStyle, "normal");
  const runs = parseRuns(props.runs);

  const innerRef = React.useRef<HTMLDivElement>(null);
  const [fit, setFit] = React.useState(1);

  // After layout, measure the content vs the box and shrink to fit. Re-run when
  // anything affecting layout changes. Reset to 1 first so growth (e.g. box
  // resized larger in the editor) is re-measured from full size.
  React.useLayoutEffect(() => {
    setFit(1);
  }, [width, height, baseFontSize, props.text, props.runs]);

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

  const lines = runs ?? [{ text: str(props.text, "") }];

  return (
    <div
      style={{
        ...baseStyle,
        color: baseColor,
        fontWeight: baseWeight,
        fontStyle: baseFontStyle,
        fontFamily: str(props.fontFamily, "system-ui, sans-serif"),
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
    >
      <div ref={innerRef} style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: justify }}>
        {lines.map((r, i) => {
          const blank = !r.text.trim();
          return (
            <div
              key={i}
              style={{
                width: "100%",
                color: r.color ?? baseColor,
                fontSize: (r.fontSize ?? baseFontSize) * fit,
                // Blank paragraphs are spacing — render at half height so a run
                // of them doesn't push content off the box.
                lineHeight: blank ? 0.5 : LINE_HEIGHT,
                fontWeight: r.fontWeight ?? baseWeight,
                fontStyle: r.fontStyle ?? baseFontStyle,
                textAlign: (r.align ?? align) as React.CSSProperties["textAlign"],
              }}
            >
              {r.text || " "}
            </div>
          );
        })}
      </div>
      {children}
    </div>
  );
}

/** Coerce an untyped `props.runs` into a clean TextRun[], or null if absent. */
function parseRuns(v: unknown): TextRun[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  return v.map((raw) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    const run: TextRun = { text: typeof o.text === "string" ? o.text : "" };
    if (typeof o.fontSize === "number") run.fontSize = o.fontSize;
    if (typeof o.color === "string") run.color = o.color;
    if (typeof o.fontWeight === "string") run.fontWeight = o.fontWeight;
    if (typeof o.fontStyle === "string") run.fontStyle = o.fontStyle;
    if (o.align === "left" || o.align === "center" || o.align === "right") run.align = o.align;
    return run;
  });
}

// --- small prop coercion helpers (props are Record<string, unknown>) -------

function str(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}
function num(v: unknown, fallback: number): number {
  return typeof v === "number" ? v : fallback;
}
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}
