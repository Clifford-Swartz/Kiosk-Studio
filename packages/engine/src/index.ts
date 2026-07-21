// Public API of the Kiosk Studio engine.

// Model: the scene contract (Zod schemas + derived types).
export * from "./model/schema.js";
export * from "./model/types.js";
export {
  createElement,
  createScene,
  createProject,
  newId,
} from "./model/factory.js";

// Rendering: shared primitives used by Player and Editor.
export { ElementRenderer, resolveSrc } from "./render/ElementRenderer.js";
export type { ElementRendererProps } from "./render/ElementRenderer.js";
export { Player } from "./render/Player.js";
export type { PlayerProps } from "./render/Player.js";

// Runtime: interaction execution + live overrides.
export { runInteraction } from "./runtime/interactions.js";
export type { PlayerContext } from "./runtime/interactions.js";

// Events: central event bus for all kiosk system events.
export { eventBus } from "./events/EventBus.js";
export type { KioskEvent, EventKind, EventListener, Unsubscribe } from "./events/events.js";

// Analytics: event buffering and export (CSV, JSON, REST, console).
export { analyticsStore } from "./analytics/AnalyticsStore.js";
export type { SinkStatus } from "./analytics/AnalyticsStore.js";

// Element resolution: unified bindings + overrides pipeline.
export { elementResolver, bindingHost, overrideHost } from "./data/ElementResolver.js";
export type { ElementResolver, BindingHost, OverrideHost } from "./data/ElementResolver.js";
