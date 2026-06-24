import type { Action, Interaction, Project } from "../model/types.js";

/**
 * Context handed to actions when an interaction runs. Carries scene navigation
 * and live-state mutators (setProp/toggleVisibility write to the runtime
 * override store, not the project). Grows with more actions later.
 */
export interface PlayerContext {
  goToScene: (sceneId: string) => void;
  goBack: () => void;
  setProp: (elementId: string, key: string, value: unknown) => void;
  toggleVisibility: (elementId: string) => void;
  playAudio: (elementId: string) => void;
  togglePlayVideo: (elementId: string) => void;
  seekVideo: (elementId: string, time: number) => void;
  setVolume: (elementId: string, volume: number) => void;
  setSpeed: (elementId: string, rate: number) => void;
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

    case "goBack": {
      ctx.goBack();
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

    case "togglePlayPause": {
      const target = action.params.target;
      if (typeof target === "string") {
        ctx.togglePlayVideo(target);
      } else {
        warn("togglePlayPause action needs string params.target");
      }
      return;
    }

    case "seekVideo": {
      const target = action.params.target;
      const time = action.params.time;
      if (typeof target === "string" && typeof time === "number") {
        ctx.seekVideo(target, Math.max(0, time));
      } else {
        warn("seekVideo needs params.target (string) and params.time (number)");
      }
      return;
    }

    case "setVolume": {
      const target = action.params.target;
      const volume = action.params.volume;
      if (typeof target === "string" && typeof volume === "number") {
        ctx.setVolume(target, Math.max(0, Math.min(1, volume)));
      } else {
        warn("setVolume needs params.target (string) and params.volume (number 0-1)");
      }
      return;
    }

    case "setSpeed": {
      const target = action.params.target;
      const rate = action.params.rate;
      if (typeof target === "string" && typeof rate === "number") {
        ctx.setSpeed(target, Math.max(0.25, Math.min(4, rate)));
      } else {
        warn("setSpeed needs params.target (string) and params.rate (number 0.25-4)");
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
