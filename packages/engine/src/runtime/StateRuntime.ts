import type { Scene, Element } from "../model/types.js";
import { VisibilityManager } from "./VisibilityManager.js";

/**
 * Scene state runtime manages active state and applies visibility + property overrides.
 * Applies as layer in rendering pipeline (after bindings, before interaction overrides).
 *
 * See ADR 0011.
 */
export class StateRuntime {
  private activeStateName: string | null = null;
  private currentScene: Scene | null = null;
  private notifyChange: (() => void) | null = null;

  /**
   * Set active state for current scene. Pass "default" or null to clear state.
   * Optional sceneId validates state applies to correct scene (prevents race conditions).
   */
  setState(stateName: string | null, sceneId?: string): boolean {
    // Validate scene hasn't changed (race condition check)
    if (sceneId && this.currentScene?.id !== sceneId) {
      console.warn(`[StateRuntime] setState ignored: scene changed from ${sceneId} to ${this.currentScene?.id}`);
      return false;
    }

    if (stateName === "default") {
      this.activeStateName = null;
    } else {
      this.activeStateName = stateName;
    }
    // Notify ElementResolver to invalidate cache
    if (this.notifyChange) {
      this.notifyChange();
    }
    return true;
  }

  /**
   * Get current active state name (null = default state).
   */
  getActiveState(): string | null {
    return this.activeStateName;
  }

  /**
   * Update current scene (called on scene navigation).
   */
  setScene(scene: Scene): void {
    const isNewScene = this.currentScene?.id !== scene.id;
    this.currentScene = scene;
    if (isNewScene) {
      this.activeStateName = null; // Reset to default state only on real navigation
    }
    // Invalidate cache when scene changes
    if (this.notifyChange) {
      this.notifyChange();
    }
  }

  /**
   * Apply state overrides to element. Returns partial element with overrides.
   * Returns empty object if no active state or element not in state.
   */
  applyState(element: Element): Partial<Element> {
    if (!this.activeStateName || !this.currentScene) {
      return {};
    }

    const states = this.currentScene.states;
    if (!states) return {};

    const state = states[this.activeStateName];
    if (!state) {
      console.warn(`[StateRuntime] State "${this.activeStateName}" not found in scene "${this.currentScene?.id || 'unknown'}"`);
      return {};
    }

    const elementOverride = state.elements[element.id];
    if (!elementOverride) return {};

    const result: Partial<Element> = {};

    // Apply visibility override
    if (elementOverride.visible !== undefined) {
      result.opacity = VisibilityManager.visibleToOpacity(
        elementOverride.visible,
        element.opacity ?? 1
      );
    }

    // Apply property overrides (return only overrides, let pipeline merge)
    if (elementOverride.props) {
      result.props = elementOverride.props;
    }

    return result;
  }

  /**
   * Set change notification callback (called by ElementResolver to invalidate cache on state changes).
   */
  setNotifyChange(callback: (() => void) | null): void {
    this.notifyChange = callback;
  }

  /**
   * Check if element is visible in current state.
   * Returns true if no state active or element has no visibility override.
   */
  isVisible(element: Element): boolean {
    return VisibilityManager.isVisibleInState(
      element,
      this.activeStateName ?? undefined,
      this.currentScene ?? { states: {} }
    );
  }
}
