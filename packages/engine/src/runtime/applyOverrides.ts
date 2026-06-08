import type { Element } from "../model/types.js";

/**
 * Apply runtime overrides (from interactions) on top of an element. Pure. The
 * special key "__hidden" (boolean) implements toggleVisibility by forcing
 * opacity to 0; all other keys are written into the element's props (e.g.
 * text, fill, color). Live only — never persisted to the project.
 */
export function applyOverrides(
  element: Element,
  overrides: Record<string, unknown> | undefined
): Element {
  if (!overrides) return element;
  let next = element;
  let propsCloned = false;

  for (const [key, value] of Object.entries(overrides)) {
    if (key === "__hidden") {
      if (value) next = { ...next, opacity: 0 };
      continue;
    }
    if (!propsCloned) {
      next = { ...next, props: { ...next.props } };
      propsCloned = true;
    }
    next.props[key] = value;
  }
  return next;
}
