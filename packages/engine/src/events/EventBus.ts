import type { EventKind, EventListener, KioskEvent, Unsubscribe } from "./events.js";

/**
 * Central event bus for all kiosk system events. Singleton, synchronous dispatch.
 *
 * Producers: Player, interactions.ts, ElementRenderer, data connectors
 * Consumers: BindingContext (dataChanged), AnalyticsStore (all events per sink config)
 *
 * EventBus auto-injects:
 * - timestamp (if missing from emitted event)
 * - sessionId (set by Player on mount)
 * - sceneId (tracked via setCurrentScene, always present)
 *
 * Usage:
 *   eventBus.emit({ kind: "sceneEnter", payload: { sceneId, sceneName } });
 *   eventBus.subscribe("dataChanged", (event) => { ... });
 */
class EventBusImpl {
  private listeners = new Map<EventKind, Set<EventListener>>();
  private sessionId: string = "";
  private currentSceneId: string = "";

  /**
   * Set the current session ID. Called by Player on mount.
   */
  setSessionId(id: string): void {
    this.sessionId = id;
  }

  /**
   * Set the current scene ID. Called by Player on navigation.
   */
  setCurrentScene(id: string): void {
    this.currentSceneId = id;
  }

  /**
   * Emit an event to all subscribers of that event kind.
   * Auto-injects timestamp, sessionId, sceneId if missing.
   */
  emit(event: Partial<KioskEvent> & { kind: EventKind }): void {
    const fullEvent: KioskEvent = {
      timestamp: event.timestamp ?? Date.now(),
      sessionId: event.sessionId ?? this.sessionId,
      sceneId: event.sceneId ?? this.currentSceneId,
      payload: event.payload ?? {},
      kind: event.kind,
    };

    const subs = this.listeners.get(fullEvent.kind);
    if (subs) {
      for (const listener of subs) {
        listener(fullEvent);
      }
    }
  }

  /**
   * Subscribe to a specific event kind. Returns unsubscribe function.
   */
  subscribe(kind: EventKind, listener: EventListener): Unsubscribe {
    if (!this.listeners.has(kind)) {
      this.listeners.set(kind, new Set());
    }
    this.listeners.get(kind)!.add(listener);

    return () => {
      const subs = this.listeners.get(kind);
      if (subs) {
        subs.delete(listener);
        if (subs.size === 0) {
          this.listeners.delete(kind);
        }
      }
    };
  }

  /**
   * Subscribe to all event kinds. Returns unsubscribe function.
   * Used by analytics sinks with wildcard event filters.
   */
  subscribeAll(listener: EventListener): Unsubscribe {
    const unsubs: Unsubscribe[] = [];
    const kinds: EventKind[] = [
      "dataChanged",
      "dataError",
      "sessionStart",
      "sessionEnd",
      "sceneEnter",
      "sceneExit",
      "elementTap",
      "elementHover",
      "elementPress",
      "elementRelease",
      "actionRun",
      "videoPlay",
      "videoPause",
      "videoComplete",
      "videoSeek",
      "audioPlay",
      "audioPause",
      "audioComplete",
    ];

    for (const kind of kinds) {
      unsubs.push(this.subscribe(kind, listener));
    }

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }

  /**
   * Clear all listeners. Used by tests.
   */
  reset(): void {
    this.listeners.clear();
    this.sessionId = "";
    this.currentSceneId = "";
  }
}

/** Singleton EventBus instance (lazy init on first import) */
export const eventBus = new EventBusImpl();
