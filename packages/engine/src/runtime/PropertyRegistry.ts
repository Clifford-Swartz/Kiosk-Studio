import type { Element } from "../model/types.js";

// Type definitions (moved from AnimationRuntime.ts)
export type AnimatableProperty = "position" | "scale" | "opacity" | "rotation";

export type AnimatableValue =
  | number // opacity, rotation
  | { x: number; y: number } // position
  | { width: number; height: number }; // scale

// Property metadata registry
export interface PropertyMetadata {
  semantic: AnimatableProperty;
  fields: string[];
  valueType: "scalar" | "xy" | "wh";
  defaultValue: AnimatableValue;
  isGeometry: boolean;
}

export const ANIMATABLE_PROPS: readonly PropertyMetadata[] = [
  {
    semantic: "position",
    fields: ["x", "y"],
    valueType: "xy",
    defaultValue: { x: 0, y: 0 },
    isGeometry: true,
  },
  {
    semantic: "scale",
    fields: ["width", "height"],
    valueType: "wh",
    defaultValue: { width: 100, height: 100 },
    isGeometry: true,
  },
  {
    semantic: "opacity",
    fields: ["opacity"],
    valueType: "scalar",
    defaultValue: 1,
    isGeometry: false,
  },
  {
    semantic: "rotation",
    fields: ["rotation"],
    valueType: "scalar",
    defaultValue: 0,
    isGeometry: true,
  },
] as const;

/**
 * Get property metadata by semantic name.
 */
export function getPropertyMeta(
  semantic: AnimatableProperty
): PropertyMetadata | undefined {
  return ANIMATABLE_PROPS.find((p) => p.semantic === semantic);
}

/**
 * Get element field names for an animatable property.
 * Example: "position" → ["x", "y"]
 */
export function getFields(property: AnimatableProperty): string[] {
  const meta = getPropertyMeta(property);
  return meta?.fields ?? [];
}

/**
 * Get default value for an animatable property.
 * Example: "position" → {x: 0, y: 0}
 */
export function getDefaultValue(property: AnimatableProperty): AnimatableValue {
  const meta = getPropertyMeta(property);
  if (!meta) throw new Error(`Unknown property: ${property}`);
  return meta.defaultValue;
}

/**
 * Check if property maps to geometry fields (x, y, width, height, rotation, opacity).
 * Returns false for non-geometry properties (future: color, fontSize, blur).
 */
export function isGeometry(property: AnimatableProperty): boolean {
  const meta = getPropertyMeta(property);
  return meta?.isGeometry ?? false;
}

/**
 * Extract current value of an animatable property from an element.
 * Falls back to defaults if element fields are undefined.
 *
 * Example:
 *   getCurrentValue({x: 50, y: 100}, "position") → {x: 50, y: 100}
 *   getCurrentValue({}, "position") → {x: 0, y: 0}
 */
export function getCurrentValue(
  element: Partial<Element>,
  property: AnimatableProperty
): AnimatableValue {
  const meta = getPropertyMeta(property);
  if (!meta) return getDefaultValue(property);

  if (meta.valueType === "xy") {
    const defaultXY = meta.defaultValue as { x: number; y: number };
    return {
      x: (element.x as number) ?? defaultXY.x,
      y: (element.y as number) ?? defaultXY.y,
    };
  }

  if (meta.valueType === "wh") {
    const defaultWH = meta.defaultValue as { width: number; height: number };
    return {
      width: (element.width as number) ?? defaultWH.width,
      height: (element.height as number) ?? defaultWH.height,
    };
  }

  // Scalar
  const field = meta.fields[0];
  return (element[field as keyof Element] as number) ?? (meta.defaultValue as number);
}

/**
 * Decompose an animatable value into element field assignments.
 * Inverse of getCurrentValue() — converts semantic property value to field map.
 *
 * Example:
 *   decomposeValue("position", {x: 50, y: 100}) → {x: 50, y: 100}
 *   decomposeValue("opacity", 0.5) → {opacity: 0.5}
 */
export function decomposeValue(
  property: AnimatableProperty,
  value: AnimatableValue
): Record<string, number> {
  const meta = getPropertyMeta(property);
  if (!meta) return {};

  if (meta.valueType === "xy") {
    const { x, y } = value as { x: number; y: number };
    return { x, y };
  }

  if (meta.valueType === "wh") {
    const { width, height } = value as { width: number; height: number };
    return { width, height };
  }

  // Scalar
  return { [meta.fields[0]]: value as number };
}
