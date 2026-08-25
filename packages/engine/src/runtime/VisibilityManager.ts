import type { Element } from "../model/types.js";

/**
 * Unified visibility predicate for elements.
 *
 * `visible` flows through the same schema -> bindings -> state -> interaction
 * overrides -> animations merge as any other field (see ElementResolver) and
 * is NOT clamped there. ElementRenderer, the sole rendering consumer, derives
 * the final render opacity from `visible` itself, branching on `editorMode`:
 * the editor canvas dims (rather than hides) invisible elements so they stay
 * selectable, while Player/runtime forces opacity to 0 unconditionally when
 * `visible` is false. See ADR 0013.
 */
export class VisibilityManager {
  /**
   * @param element - element to check (base or resolved)
   * @returns true unless `visible` is explicitly false
   */
  static isVisible(element: Partial<Element>): boolean {
    return element.visible !== false;
  }
}
