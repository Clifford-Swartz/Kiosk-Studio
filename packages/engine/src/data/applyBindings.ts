import type { Binding, Element } from "../model/types.js";

/**
 * Apply data bindings to an element, producing a shallow clone whose bound
 * target props carry the current live values. Pure — given the same element and
 * value-getter, returns the same result. Live values are never written back to
 * the project; this only affects what gets rendered.
 *
 * Supported `targetProp` forms:
 *   "text"        -> element.text? no — top-level props live under .props, so we
 *                    treat a bare key as a props key: props["text"].
 *   "props.fill"  -> props["fill"] (explicit)
 *   "x" | "y" | "width" | "height" | "opacity" | "rotation" -> geometry fields.
 *
 * `path` dot-walks into the fetched value (e.g. "main.temp", "0.name").
 */

const GEOMETRY = new Set(["x", "y", "width", "height", "opacity", "rotation", "zIndex"]);

function walk(value: unknown, path?: string): unknown {
  if (!path) return value;
  let cur: unknown = value;
  for (const key of path.split(".")) {
    if (cur == null) return undefined;
    if (Array.isArray(cur)) cur = cur[Number(key)];
    else if (typeof cur === "object") cur = (cur as Record<string, unknown>)[key];
    else return undefined;
  }
  return cur;
}

/** Resolve the target field a binding writes to. */
function targetKey(targetProp: string): { scope: "geometry" | "props"; key: string } {
  if (targetProp.startsWith("props.")) return { scope: "props", key: targetProp.slice(6) };
  if (GEOMETRY.has(targetProp)) return { scope: "geometry", key: targetProp };
  return { scope: "props", key: targetProp };
}

export function resolveBindings(
  element: Element,
  getValue: (sourceId: string) => unknown
): Element {
  const bindings = element.bindings;
  if (!bindings || bindings.length === 0) return element;

  let next = element;
  let propsCloned = false;

  for (const b of bindings as Binding[]) {
    const raw = getValue(b.source);
    if (raw === undefined) continue;
    const resolved = walk(raw, b.path);
    if (resolved === undefined) continue;

    const { scope, key } = targetKey(b.targetProp);
    if (scope === "geometry") {
      const n = Number(resolved);
      if (Number.isFinite(n)) next = { ...next, [key]: n };
    } else {
      if (!propsCloned) {
        next = { ...next, props: { ...next.props } };
        propsCloned = true;
      }
      // Text-display props must be strings (the renderer ignores non-strings),
      // so coerce numbers/booleans too. Other props: pass through, stringifying
      // only objects.
      const isTextProp = key === "text" || key === "label";
      if (isTextProp) {
        next.props[key] =
          resolved == null
            ? ""
            : typeof resolved === "object"
              ? JSON.stringify(resolved)
              : String(resolved);
      } else {
        next.props[key] = typeof resolved === "object" ? JSON.stringify(resolved) : resolved;
      }
    }
  }

  return next;
}
