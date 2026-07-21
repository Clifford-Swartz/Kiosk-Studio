/**
 * Per-element-type editable property whitelist. Single source of truth for
 * both the Properties/Interactions dropdowns and the AI tool schema — an
 * element type's valid prop keys are defined here once.
 */
export interface EditableProp {
  key: string;
  label: string;
  valueType: "color" | "number" | "text";
}

/**
 * Get editable properties for an element type.
 * Returns flat list (no geometry: no x, y, width, height, rotation, opacity, zIndex).
 */
export function getEditableProps(type: string): EditableProp[] {
  switch (type) {
    case "text":
      return [
        { key: "text", label: "Text", valueType: "text" },
        { key: "fontSize", label: "Font Size", valueType: "number" },
        { key: "color", label: "Text Color", valueType: "color" },
      ];
    case "rectangle":
      return [
        { key: "fill", label: "Fill Color", valueType: "color" },
        { key: "radius", label: "Border Radius", valueType: "number" },
      ];
    case "button":
      return [
        { key: "label", label: "Label", valueType: "text" },
        { key: "fill", label: "Fill Color", valueType: "color" },
        { key: "color", label: "Text Color", valueType: "color" },
        { key: "radius", label: "Border Radius", valueType: "number" },
      ];
    case "video":
      return [
        { key: "volume", label: "Volume", valueType: "number" },
        { key: "playbackRate", label: "Playback Speed", valueType: "number" },
      ];
    case "audio":
      return [
        { key: "volume", label: "Volume", valueType: "number" },
      ];
    default:
      return [];
  }
}
