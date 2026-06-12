import type { ElementType } from "@kiosk/engine";
import { useEditor } from "./store.js";

/** Left panel: click to add an element of each type to the active scene. */
const ITEMS: { type: ElementType; label: string; icon: string }[] = [
  { type: "rectangle", label: "Rectangle", icon: "▭" },
  { type: "text", label: "Text", icon: "T" },
  { type: "image", label: "Image", icon: "🖼" },
  { type: "audio", label: "Audio", icon: "🔊" },
  { type: "button", label: "Button", icon: "⬭" },
  { type: "collection", label: "Collection", icon: "▦" },
];

export function Palette() {
  const addElement = useEditor((s) => s.addElement);
  return (
    <div style={panel}>
      <div style={heading}>Add element</div>
      {ITEMS.map((it) => (
        <button key={it.type} style={item} onClick={() => addElement(it.type)}>
          <span style={{ width: 20, textAlign: "center" }}>{it.icon}</span>
          {it.label}
        </button>
      ))}
    </div>
  );
}

const panel: React.CSSProperties = {
  flexShrink: 0,
  background: "#0e1218",
  padding: "14px 12px",
  display: "flex",
  flexDirection: "column",
  gap: 6,
};
const heading: React.CSSProperties = {
  color: "#7c8aa0",
  fontSize: 10.5,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 0.8,
  margin: "2px 2px 10px",
};
const item: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "10px 12px",
  background: "#161c26",
  border: "1px solid #232c3a",
  borderRadius: 8,
  color: "#e2e8f0",
  fontSize: 14,
  cursor: "pointer",
  textAlign: "left",
};
