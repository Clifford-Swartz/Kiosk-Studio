import { useSyncExternalStore } from "react";
import { bindingStore } from "./bindingStore.js";

/**
 * DEPRECATED: Use bindingContext.useElement() instead (see ./BindingContext.ts).
 *
 * This module will be removed in a future version. The binding pipeline has been
 * consolidated into BindingContext, which handles subscription + resolution
 * behind a single interface.
 *
 * Subscribe a component to the shared binding store. Returns a stable getter
 * for live values; the component re-renders whenever any value changes.
 */
export function useBindingValues(): (sourceId: string) => unknown {
  useSyncExternalStore(bindingStore.subscribe, bindingStore.getSnapshot, bindingStore.getSnapshot);
  return (sourceId: string) => bindingStore.getValue(sourceId);
}
