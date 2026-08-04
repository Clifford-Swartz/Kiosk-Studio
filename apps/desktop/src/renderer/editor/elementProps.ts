/**
 * Per-element-type editable property whitelist. Single source of truth for
 * both the Properties/Interactions dropdowns and the AI tool schema — an
 * element type's valid prop keys are defined here once.
 */
export interface EditableProp {
  key: string;
  label: string;
  valueType: "color" | "number" | "text" | "boolean" | "richtext";
}

/** Every element type has this — the one geometry field editable outside the Properties panel's dedicated slider (e.g. via a "Set property" interaction action). */
const OPACITY_PROP: EditableProp = { key: "opacity", label: "Opacity", valueType: "number" };

/** Every element type has this — the discrete visibility gate (ADR 0013). Lets a "Set property" action set visibility to a specific state, complementing the existing "Toggle visibility" action. */
const VISIBLE_PROP: EditableProp = { key: "visible", label: "Visible", valueType: "boolean" };

/**
 * Get editable properties for an element type.
 * Returns flat list of props (no x, y, width, height, rotation, zIndex — those
 * stay geometry-drag-only). `opacity` and `visible` are included on every type
 * since they're commonly targeted by "Set property" interactions and the AI tool.
 */
export function getEditableProps(type: string): EditableProp[] {
  switch (type) {
    case "text":
      return [
        { key: "text", label: "Text", valueType: "text" },
        { key: "content", label: "Text (Rich)", valueType: "richtext" },
        { key: "fontSize", label: "Font Size", valueType: "number" },
        { key: "color", label: "Text Color", valueType: "color" },
        OPACITY_PROP,
        VISIBLE_PROP,
      ];
    case "rectangle":
      return [
        { key: "fill", label: "Fill Color", valueType: "color" },
        { key: "radius", label: "Border Radius", valueType: "number" },
        OPACITY_PROP,
        VISIBLE_PROP,
      ];
    case "button":
      return [
        { key: "label", label: "Label", valueType: "text" },
        { key: "fill", label: "Fill Color", valueType: "color" },
        { key: "color", label: "Text Color", valueType: "color" },
        { key: "radius", label: "Border Radius", valueType: "number" },
        OPACITY_PROP,
        VISIBLE_PROP,
      ];
    case "video":
      return [
        { key: "volume", label: "Volume", valueType: "number" },
        { key: "playbackRate", label: "Playback Speed", valueType: "number" },
        OPACITY_PROP,
        VISIBLE_PROP,
      ];
    case "audio":
      return [
        { key: "volume", label: "Volume", valueType: "number" },
        OPACITY_PROP,
        VISIBLE_PROP,
      ];
    default:
      return [OPACITY_PROP, VISIBLE_PROP];
  }
}
