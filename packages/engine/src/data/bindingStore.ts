/**
 * A tiny reactive store of live data values, keyed by data-source id. The
 * connector host (main process) pushes values into the renderer, which calls
 * `setValue`; the Player subscribes and re-renders. Framework-agnostic (plain
 * listeners) so the engine core stays React-free. Exposes a version snapshot
 * suitable for React's useSyncExternalStore.
 */
export class BindingStore {
  private values = new Map<string, unknown>();
  private listeners = new Set<() => void>();
  private version = 0;

  setValue(sourceId: string, value: unknown): void {
    this.values.set(sourceId, value);
    this.bump();
  }

  getValue(sourceId: string): unknown {
    return this.values.get(sourceId);
  }

  /** Clear all values (e.g. when ending a live session). */
  reset(): void {
    if (this.values.size === 0) return;
    this.values.clear();
    this.bump();
  }

  /** Subscribe to any change; returns an unsubscribe. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Monotonic snapshot key for useSyncExternalStore. */
  getSnapshot = (): number => this.version;

  private bump(): void {
    this.version++;
    for (const l of this.listeners) l();
  }
}

/** The single shared store used across the app. */
export const bindingStore = new BindingStore();
