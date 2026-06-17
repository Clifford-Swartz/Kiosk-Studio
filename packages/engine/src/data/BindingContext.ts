import { useSyncExternalStore } from "react";
import type { Binding, Element } from "../model/types.js";

/**
 * React-facing interface: subscribe to binding changes and resolve elements
 * with live values. Used by Player and other rendering components.
 */
export interface BindingContext {
  /**
   * React hook: subscribe to binding changes. Must be called at component top-level,
   * not in loops or conditions. Returns a stable resolver function.
   */
  useBindings(): (element: Element) => Element;
}

/**
 * Connector-facing interface: update live data values and manage lifecycle.
 * Used by the main process / connector host to push data into the renderer.
 */
export interface BindingHost {
  /** Update a data source value. Triggers subscribers. */
  setValue(sourceId: string, value: unknown): void;

  /** Clear all live values (e.g., end live session). */
  reset(): void;

  /** Clear resolution cache (e.g., when project structure changes in editor). */
  clearCache(): void;
}

/**
 * Internal implementation: consolidates bindingStore + applyBindings + useBindings
 * behind clean React and connector interfaces. Singleton pattern (one shared instance).
 * Cache clears on every setValue (Option D: reuse within render cycle only).
 */
class BindingContextImpl implements BindingContext, BindingHost {
  private values = new Map<string, unknown>();
  private listeners = new Set<() => void>();
  private version = 0;

  // Memoization cache: element.id -> { version, resolved }
  // Valid only within one version (between setValues). Cleared on bump().
  private cache = new Map<string, { version: number; resolved: Element }>();

  // BindingHost methods
  setValue(sourceId: string, value: unknown): void {
    this.values.set(sourceId, value);
    this.bump();
  }

  reset(): void {
    if (this.values.size === 0) return;
    this.values.clear();
    this.cache.clear();
    this.bump();
  }

  clearCache(): void {
    this.cache.clear();
  }

  // Stable resolver bound to this instance (doesn't recreate)
  private resolveElement = (element: Element): Element => {
    // Check cache first
    const cached = this.cache.get(element.id);
    if (cached && cached.version === this.version) {
      return cached.resolved;
    }

    // Resolve bindings
    const resolved = this.resolveBindings(element);
    this.cache.set(element.id, { version: this.version, resolved });
    return resolved;
  };

  // BindingContext methods (React interface)
  useBindings = (): ((element: Element) => Element) => {
    // Subscribe to changes (hook call at top level, safe)
    useSyncExternalStore(this.subscribe, this.getSnapshot, this.getSnapshot);

    // Return stable resolver function (same reference every call)
    return this.resolveElement;
  };

  // Internal helpers
  private getValue = (sourceId: string): unknown => {
    const value = this.values.get(sourceId);
    // Uncomment for debugging missing sources:
    // if (value === undefined) {
    //   console.warn(`[BindingContext] Source "${sourceId}" not found`);
    // }
    return value;
  };

  private subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private getSnapshot = (): number => this.version;

  private bump(): void {
    this.version++;
    this.cache.clear(); // Clear cache when data changes (Option D)
    for (const l of this.listeners) l();
  }

  private resolveBindings(element: Element): Element {
    const bindings = element.bindings;
    if (!bindings || bindings.length === 0) return element;

    let next = element;
    let propsCloned = false;

    for (const b of bindings as Binding[]) {
      const raw = this.getValue(b.source);
      if (raw === undefined) continue;
      const resolved = walk(raw, b.path);
      if (resolved === undefined) continue;

      const { scope, key } = targetKey(b.targetProp);
      if (scope === "geometry") {
        const n = Number(resolved);
        if (Number.isFinite(n)) next = { ...next, [key]: n };
      } else {
        if (!propsCloned) {
          next = { ...next, props: { ...next.props } };
          propsCloned = true;
        }
        const isTextProp = key === "text" || key === "label";
        if (isTextProp) {
          next.props[key] =
            resolved == null
              ? ""
              : typeof resolved === "object"
                ? JSON.stringify(resolved)
                : String(resolved);
        } else {
          next.props[key] = typeof resolved === "object" ? JSON.stringify(resolved) : resolved;
        }
      }
    }

    return next;
  }
}

// Helper functions (originally from applyBindings.ts)
const GEOMETRY = new Set(["x", "y", "width", "height", "opacity", "rotation", "zIndex"]);

function walk(value: unknown, path?: string): unknown {
  if (!path) return value;
  let cur: unknown = value;
  for (const key of path.split(".")) {
    if (cur == null) return undefined;
    if (Array.isArray(cur)) cur = cur[Number(key)];
    else if (typeof cur === "object") cur = (cur as Record<string, unknown>)[key];
    else return undefined;
  }
  return cur;
}

function targetKey(targetProp: string): { scope: "geometry" | "props"; key: string } {
  if (targetProp.startsWith("props.")) return { scope: "props", key: targetProp.slice(6) };
  if (GEOMETRY.has(targetProp)) return { scope: "geometry", key: targetProp };
  return { scope: "props", key: targetProp };
}

// Singleton exports
const instance = new BindingContextImpl();

export const bindingContext: BindingContext = instance;
export const bindingHost: BindingHost = instance;
