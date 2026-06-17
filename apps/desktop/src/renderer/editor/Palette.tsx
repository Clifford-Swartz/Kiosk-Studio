import type { ElementType } from "@kiosk/engine";
import { useEditor } from "./store.js";

/** Left panel: click to add an element of each type to the active scene. */
const ITEMS: { type: ElementType; label: string; icon: string }[] = [
  { type: "rectangle", label: "Rectangle", icon: "▭" },
  { type: "text", label: "Text", icon: "T" },
  { type: "image", label: "Image", icon: "🖼" },
  { type: "video", label: "Video", icon: "🎬" },
  { type: "audio", label: "Audio", icon: "🔊" },
  { type: "button", label: "Button", icon: "[ ]" },
  { type: "collection", label: "Collection", icon: "▦" },
];

export function Palette() {
  const addElement = useEditor((s) => s.addElement);
  return (
    <div style={panel}>
      <div style={heading}>Add element</div>
      <div style={grid}>
        {ITEMS.map((it) => (
          <button
            key={it.type}
            style={item}
            onClick={() => addElement(it.type)}
            title={it.label}
          >
            {it.icon}
          </button>
        ))}
      </div>
    </div>
  );
}

const panel: React.CSSProperties = {
  flexShrink: 0,
  background: "#12161d",
  padding: "14px 12px",
};
const heading: React.CSSProperties = {
  color: "#7c8aa0",
  fontSize: 10.5,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 0.8,
  margin: "2px 2px 10px",
};
const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: 6,
};
const item: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "14px 10px",
  background: "#0e1218",
  border: "1px solid #34393f",
  borderRadius: 8,
  color: "#e2e8f0",
  fontSize: 20,
  cursor: "pointer",
};
