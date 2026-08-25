import type { Action, Interaction, Project, Element } from "../model/types.js";
import { eventBus } from "../events/EventBus.js";
import type { AnimatableProperty, AnimatableValue } from "./PropertyRegistry.js";
import type { EasingCurve } from "./easings.js";

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
  scrubVideo: (
    elementId: string,
    from: number | undefined,
    to: number,
    duration: number,
    easing?: EasingCurve,
    delay?: number
  ) => Promise<void>;
  setVolume: (elementId: string, volume: number) => void;
  setSpeed: (elementId: string, rate: number) => void;
  animate: (
    elementId: string,
    property: AnimatableProperty,
    from: AnimatableValue | undefined,
    to: AnimatableValue,
    duration: number,
    easing?: EasingCurve,
    delay?: number
  ) => Promise<void>;
  setState: (stateName: string, animated?: boolean, duration?: number) => Promise<void>;
  project: Project;
}

/**
 * Execute every action in an interaction, in order.
 * Now async to support blocking animations in interaction sequences.
 */
export async function runInteraction(interaction: Interaction, ctx: PlayerContext, element?: Element): Promise<void> {
  // Emit element event for trigger
  if (element) {
    switch (interaction.trigger) {
      case "tap":
        eventBus.emit({
          kind: "elementTap",
          payload: { elementId: element.id, elementType: element.type }
        });
        break;
      case "hover":
        eventBus.emit({
          kind: "elementHover",
          payload: { elementId: element.id, elementType: element.type }
        });
        break;
      case "press":
        eventBus.emit({
          kind: "elementPress",
          payload: { elementId: element.id, elementType: element.type }
        });
        break;
      case "release":
        eventBus.emit({
          kind: "elementRelease",
          payload: { elementId: element.id, elementType: element.type }
        });
        break;
    }
  }

  for (let i = 0; i < interaction.actions.length; i++) {
    const action = interaction.actions[i];
    await runAction(action, ctx, element);
  }
}

async function runAction(action: Action, ctx: PlayerContext, element?: Element): Promise<void> {
  // Emit actionRun event
  eventBus.emit({
    kind: "actionRun",
    payload: {
      actionType: action.type,
      params: action.params,
      elementId: element?.id
    }
  });

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

    case "scrubVideo": {
      const target = action.params.target;
      const from = action.params.from;
      const to = action.params.to;
      const duration = action.params.duration;
      const easing = action.params.easing;
      const delay = action.params.delay;
      if (typeof target !== "string" || typeof to !== "number" || typeof duration !== "number") {
        warn("scrubVideo needs params.target (string), params.to (number), and params.duration (number)");
        return;
      }
      await ctx.scrubVideo(
        target,
        typeof from === "number" ? from : undefined,
        to,
        duration,
        (easing as EasingCurve) ?? "linear",
        (delay as number) ?? 0
      );
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

    case "animate": {
      const { target, property, from, to, duration, easing, delay } = action.params;
      if (typeof target !== "string" || typeof property !== "string" || !to || typeof duration !== "number") {
        warn("animate needs params.target (string), params.property (string), params.to, params.duration (number)");
        return;
      }
      await ctx.animate(
        target,
        property as AnimatableProperty,
        from as AnimatableValue | undefined,
        to as AnimatableValue,
        duration,
        (easing as EasingCurve) ?? "linear",
        (delay as number) ?? 0
      );
      return;
    }

    case "setState": {
      const { stateName, animated, duration } = action.params;
      if (typeof stateName !== "string") {
        warn("setState needs params.stateName (string)");
        return;
      }
      await ctx.setState(
        stateName,
        (animated as boolean) ?? false,
        (duration as number) ?? 300
      );
      return;
    }

    case "parallel": {
      const nested = action.params.actions;
      if (!Array.isArray(nested)) {
        warn("parallel action needs params.actions (array)");
        return;
      }
      await Promise.all(nested.map((a) => runAction(a as Action, ctx, element)));
      return;
    }

    // Implemented in later milestones.
    case "sendData":
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
