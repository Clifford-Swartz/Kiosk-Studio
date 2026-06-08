import { useSyncExternalStore } from "react";
import { bindingStore } from "./bindingStore.js";

/**
 * Subscribe a component to the shared binding store. Returns a stable getter
 * for live values; the component re-renders whenever any value changes.
 */
export function useBindingValues(): (sourceId: string) => unknown {
  useSyncExternalStore(bindingStore.subscribe, bindingStore.getSnapshot, bindingStore.getSnapshot);
  return (sourceId: string) => bindingStore.getValue(sourceId);
}
