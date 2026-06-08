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
export { overrideStore, OverrideStore } from "./runtime/overrideStore.js";
export { applyOverrides } from "./runtime/applyOverrides.js";
export { useOverrides } from "./runtime/useOverrides.js";

// Data binding: live values from connectors -> element props.
export { bindingStore, BindingStore } from "./data/bindingStore.js";
export { resolveBindings } from "./data/applyBindings.js";
export { useBindingValues } from "./data/useBindings.js";
