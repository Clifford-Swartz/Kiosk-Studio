import { useSyncExternalStore } from "react";
import type { Binding, Element } from "../model/types.js";

/**
 * React-facing interface: subscribe to element changes (bindings + overrides)
 * and resolve elements with live values. Used by Player and rendering components.
 */
export interface ElementResolver {
  /**
   * React hook: subscribe to element resolution changes. Must be called at
   * component top-level. Returns a stable resolver function.
   */
  useResolveElement(): (element: Element) => Element;
}

/**
 * Connector-facing interface: update live binding data.
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
 * Interaction-facing interface: update runtime overrides (ephemeral mutations).
 */
export interface OverrideHost {
  /** Set an override on an element prop. Special key "__hidden" sets opacity to 0. */
  setOverride(elementId: string, key: string, value: unknown): void;

  /** Toggle a boolean override. Returns new value. */
  toggleOverride(elementId: string, key: string): boolean;

  /** Clear all overrides (e.g., on scene change). */
  resetOverrides(): void;
}

/**
 * Unified element resolver: combines binding resolution + override application
 * into a single pipeline with one cache. Consolidates BindingContext + OverrideStore.
 */
class ElementResolverImpl implements ElementResolver, BindingHost, OverrideHost {
  // Binding state
  private bindingValues = new Map<string, unknown>();

  // Override state (ephemeral, runtime-only mutations)
  private overrides = new Map<string, Record<string, unknown>>();

  // Shared subscription state
  private listeners = new Set<() => void>();
  private version = 0;

  // Unified cache: element.id -> { version, resolved }
  // Caches the COMBINED result (bindings + overrides)
  private cache = new Map<string, { version: number; resolved: Element }>();

  // BindingHost methods
  setValue(sourceId: string, value: unknown): void {
    this.bindingValues.set(sourceId, value);
    this.bump();
  }

  reset(): void {
    if (this.bindingValues.size === 0) return;
    this.bindingValues.clear();
    this.cache.clear();
    this.bump();
  }

  clearCache(): void {
    this.cache.clear();
    this.version++; // Force cache miss after project structure changes
  }

  // OverrideHost methods
  setOverride(elementId: string, key: string, value: unknown): void {
    const cur = this.overrides.get(elementId) ?? {};
    this.overrides.set(elementId, { ...cur, [key]: value });
    this.bump();
  }

  toggleOverride(elementId: string, key: string): boolean {
    const cur = this.overrides.get(elementId) ?? {};
    const next = !cur[key];
    this.overrides.set(elementId, { ...cur, [key]: next });
    this.bump();
    return next;
  }

  resetOverrides(): void {
    if (this.overrides.size === 0) return;
    this.overrides.clear();
    this.bump();
  }

  // Stable resolver bound to this instance (doesn't recreate)
  private resolveElement = (element: Element): Element => {
    // Check cache first
    const cached = this.cache.get(element.id);
    if (cached && cached.version === this.version) {
      return cached.resolved;
    }

    // Resolve bindings first
    let resolved = this.resolveBindings(element);

    // Apply overrides on top
    resolved = this.applyOverrides(resolved, element.id);

    // Cache combined result
    this.cache.set(element.id, { version: this.version, resolved });
    return resolved;
  };

  // ElementResolver methods (React interface)
  useResolveElement = (): ((element: Element) => Element) => {
    // Subscribe to changes (hook call at top level, safe)
    useSyncExternalStore(this.subscribe, this.getSnapshot, this.getSnapshot);

    // Return stable resolver function (same reference every call)
    return this.resolveElement;
  };

  // Internal: binding resolution
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

  // Internal: override application
  private applyOverrides(element: Element, elementId: string): Element {
    const overrides = this.overrides.get(elementId);
    if (!overrides) return element;

    let next = element;
    let propsCloned = false;

    for (const [key, value] of Object.entries(overrides)) {
      // Special key: __hidden forces opacity to 0
      if (key === "__hidden") {
        if (value) next = { ...next, opacity: 0 };
        continue;
      }
      if (!propsCloned) {
        next = { ...next, props: { ...next.props } };
        propsCloned = true;
      }
      next.props[key] = value;
    }

    return next;
  }

  // Internal helpers
  private getValue = (sourceId: string): unknown => {
    return this.bindingValues.get(sourceId);
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
    this.cache.clear(); // Clear cache on any change
    for (const l of this.listeners) l();
  }
}

// Helper functions (from original BindingContext)
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
const instance = new ElementResolverImpl();

export const elementResolver: ElementResolver = instance;
export const bindingHost: BindingHost = instance;
export const overrideHost: OverrideHost = instance;
