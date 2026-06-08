import { useSyncExternalStore } from "react";
import { overrideStore } from "./overrideStore.js";

/**
 * Subscribe a component to the runtime override store. Returns a getter for an
 * element's current overrides; the component re-renders when any change.
 */
export function useOverrides(): (elementId: string) => Record<string, unknown> | undefined {
  useSyncExternalStore(overrideStore.subscribe, overrideStore.getSnapshot, overrideStore.getSnapshot);
  return (elementId: string) => overrideStore.getOverrides(elementId);
}
