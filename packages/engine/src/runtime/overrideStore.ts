/**
 * Runtime overrides: live, ephemeral changes to element props produced by
 * interactions (e.g. tap → set title text, toggle visibility). These are NOT
 * saved to the project — they layer on top at render time and reset on scene
 * change / Player remount. Mirrors the binding store's reactive shape.
 *
 * Keyed by element id → a bag of prop overrides. A special "__hidden" boolean
 * implements toggleVisibility.
 */
export class OverrideStore {
  private map = new Map<string, Record<string, unknown>>();
  private listeners = new Set<() => void>();
  private version = 0;

  setOverride(elementId: string, key: string, value: unknown): void {
    const cur = this.map.get(elementId) ?? {};
    this.map.set(elementId, { ...cur, [key]: value });
    this.bump();
  }

  /** Flip a boolean override (used for visibility). Returns the new value. */
  toggle(elementId: string, key: string): boolean {
    const cur = this.map.get(elementId) ?? {};
    const next = !cur[key];
    this.map.set(elementId, { ...cur, [key]: next });
    this.bump();
    return next;
  }

  getOverrides(elementId: string): Record<string, unknown> | undefined {
    return this.map.get(elementId);
  }

  reset(): void {
    if (this.map.size === 0) return;
    this.map.clear();
    this.bump();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): number => this.version;

  private bump(): void {
    this.version++;
    for (const l of this.listeners) l();
  }
}

/** Shared instance used across the app. */
export const overrideStore = new OverrideStore();
