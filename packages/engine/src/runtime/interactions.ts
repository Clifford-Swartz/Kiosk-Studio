import type { Action, Interaction, Project } from "../model/types.js";

/**
 * Context handed to actions when an interaction runs. Carries scene navigation
 * and live-state mutators (setProp/toggleVisibility write to the runtime
 * override store, not the project). Grows with more actions later.
 */
export interface PlayerContext {
  goToScene: (sceneId: string) => void;
  setProp: (elementId: string, key: string, value: unknown) => void;
  toggleVisibility: (elementId: string) => void;
  playAudio: (elementId: string) => void;
  project: Project;
}

/** Execute every action in an interaction, in order. */
export function runInteraction(interaction: Interaction, ctx: PlayerContext): void {
  for (const action of interaction.actions) {
    runAction(action, ctx);
  }
}

function runAction(action: Action, ctx: PlayerContext): void {
  switch (action.type) {
    case "goToScene": {
      const sceneId = action.params.sceneId;
      if (typeof sceneId === "string") {
        ctx.goToScene(sceneId);
      } else {
        warn("goToScene action missing string params.sceneId");
      }
      return;
    }

    case "setProp": {
      // params: { target: elementId, key: propName, value }
      const target = action.params.target;
      const key = action.params.key;
      if (typeof target === "string" && typeof key === "string") {
        ctx.setProp(target, key, action.params.value);
      } else {
        warn("setProp action needs string params.target and params.key");
      }
      return;
    }

    case "toggle": {
      // params: { target: elementId } — toggles the target's visibility.
      const target = action.params.target;
      if (typeof target === "string") {
        ctx.toggleVisibility(target);
      } else {
        warn("toggle action needs string params.target");
      }
      return;
    }

    case "playMedia": {
      // params: { target: elementId } — plays audio on the target element.
      const target = action.params.target;
      if (typeof target === "string") {
        ctx.playAudio(target);
      } else {
        warn("playMedia action needs string params.target");
      }
      return;
    }

    // Implemented in later milestones.
    case "sendData":
    case "animate":
      warn(`action '${action.type}' is not implemented yet`);
      return;

    default:
      warn(`unknown action type '${(action as Action).type}'`);
  }
}

function warn(msg: string): void {
  // eslint-disable-next-line no-console
  console.warn(`[kiosk-engine] ${msg}`);
}
