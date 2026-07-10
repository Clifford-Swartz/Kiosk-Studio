import type { Element } from "../model/types.js";

/**
 * Unified visibility control for elements.
 *
 * All visibility mechanisms (state visible, interaction __hidden, animations)
 * converge on CSS opacity property at their respective pipeline layers.
 *
 * Three visibility controls exist:
 * 1. State override `visible` boolean (layer 3) - StateRuntime
 * 2. Interaction override `__hidden` flag (layer 4) - ElementResolver
 * 3. Animation `opacity` tweens (layer 5) - AnimationRuntime
 *
 * All translate to `opacity` CSS property. No `display: none` is used.
 */
export class VisibilityManager {
  /**
   * Convert visible boolean (state override) to opacity value.
   * Used by StateRuntime at pipeline layer 3.
   *
   * @param visible - true = show element, false = hide element
   * @param baseOpacity - element's base opacity value (default 1)
   * @returns opacity value: visible ? baseOpacity : 0
   */
  static visibleToOpacity(visible: boolean, baseOpacity: number = 1): number {
    return visible ? baseOpacity : 0;
  }

  /**
   * Convert __hidden flag (interaction override) to opacity value.
   * Used by ElementResolver at pipeline layer 4.
   *
   * @param hidden - true = hide element, false = show element
   * @param baseOpacity - element's base opacity value (default 1)
   * @returns opacity value: hidden ? 0 : baseOpacity
   *
   * @deprecated Use visibleToOpacity() instead. __hidden flag maintained for backward compat.
   */
  static hiddenToOpacity(hidden: boolean, baseOpacity: number = 1): number {
    return hidden ? 0 : baseOpacity;
  }

  /**
   * Check if element is visible based on final resolved opacity.
   *
   * Visibility definition:
   * - opacity > 0 = visible (in layout, might be transparent)
   * - opacity === 0 = invisible (in layout, fully transparent)
   *
   * @param element - element with resolved opacity (after all pipeline layers)
   * @returns true if element is visible (opacity > 0)
   */
  static isVisible(element: Partial<Element>): boolean {
    return (element.opacity ?? 1) > 0;
  }

  /**
   * Check if element is visible in a specific scene state.
   * Falls back to true if state doesn't define visibility for this element.
   *
   * Used by StateRuntime.isVisible() method.
   *
   * @param element - element to check
   * @param stateName - active state name (undefined = default state)
   * @param scene - scene containing state definitions
   * @returns true if element visible in this state, false if hidden
   */
  static isVisibleInState(
    element: Element,
    stateName: string | undefined,
    scene: { states?: Record<string, { elements: Record<string, { visible?: boolean }> }> }
  ): boolean {
    if (!stateName || !scene.states) return true;

    const state = scene.states[stateName];
    if (!state) return true;

    const elementOverride = state.elements[element.id];
    if (!elementOverride) return true;

    return elementOverride.visible ?? true;
  }
}
