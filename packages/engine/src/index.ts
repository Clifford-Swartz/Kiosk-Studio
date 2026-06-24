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

// Element resolution: unified bindings + overrides pipeline.
export { elementResolver, bindingHost, overrideHost } from "./data/ElementResolver.js";
export type { ElementResolver, BindingHost, OverrideHost } from "./data/ElementResolver.js";

// DEPRECATED: Use elementResolver instead (consolidated interface).
// These will be removed in a future version.
export { bindingContext } from "./data/BindingContext.js";
export type { BindingContext } from "./data/BindingContext.js";
export { overrideStore, OverrideStore } from "./runtime/overrideStore.js";
export { applyOverrides } from "./runtime/applyOverrides.js";
export { useOverrides } from "./runtime/useOverrides.js";
