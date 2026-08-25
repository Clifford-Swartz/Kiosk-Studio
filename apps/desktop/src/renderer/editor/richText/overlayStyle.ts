import type { CSSProperties } from "react";
import type { Element } from "@kiosk/engine";

/**
 * Positioning/sizing shared by every on-canvas text-editing overlay
 * (InlineTextEditor for buttons, RichTextEditor for text) so both stay
 * pixel-aligned to the real element, which is hidden via
 * `[data-element-id="..."] { visibility: hidden }` while editingId is set.
 */
export function textEditorOverlayGeometry(element: Element, scale: number): CSSProperties {
  return {
    position: "absolute",
    left: 0,
    top: 0,
    width: element.width,
    height: element.height,
    transform: `translate(${element.x}px, ${element.y}px) rotate(${element.rotation}deg)`,
    transformOrigin: "center center",
    boxSizing: "border-box",
    outline: `${2 / scale}px solid #38bdf8`,
    background: "rgba(8,12,18,0.35)",
    cursor: "text",
    zIndex: 10000,
  };
}
