import type { Scene } from "../model/types.js";
import { getTransition } from "./transitions.js";

type TransitionState = "idle" | "transitioning";

export interface TransitionController {
  /** Transition to a new scene. Locks further calls until complete. */
  transitionTo(
    scene: Scene,
    containerEl: HTMLElement,
    outgoingEl: HTMLElement,
    incomingEl: HTMLElement,
    width: number,
    height: number
  ): Promise<void>;
  /** Current state (idle | transitioning). */
  readonly state: TransitionState;
}

export function createTransitionController(): TransitionController {
  let state: TransitionState = "idle";

  return {
    get state() {
      return state;
    },

    async transitionTo(
      scene: Scene,
      containerEl: HTMLElement,
      outgoingEl: HTMLElement,
      incomingEl: HTMLElement,
      width: number,
      height: number
    ): Promise<void> {
      if (state === "transitioning") {
        console.warn("[TransitionController] Already transitioning, ignoring");
        return;
      }

      const transition = scene.transition;
      if (!transition || transition.type === "none") {
        // Instant cut, no animation
        return;
      }

      const fn = getTransition(transition.type);
      if (!fn) {
        console.warn(`[TransitionController] Unknown transition type: ${transition.type}`);
        return;
      }

      state = "transitioning";
      try {
        await fn({
          containerEl,
          outgoingEl,
          incomingEl,
          direction: transition.direction,
          duration: transition.duration || 300,
          elementsOnly: transition.elementsOnly || false,
          width,
          height,
        });
      } finally {
        state = "idle";
      }
    },
  };
}
