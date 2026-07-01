/**
 * Event types for the kiosk EventBus. All system events flow through this
 * central pipeline: data updates, navigation, interactions, media playback.
 */

/**
 * Event kinds emitted throughout the kiosk lifecycle.
 *
 * Data flow:
 * - dataChanged: External connector value updates (REST, MQTT, etc.)
 * - dataError: Connector failures (fetch error, connection lost)
 *
 * Navigation:
 * - sessionStart: Player mount (Play/Kiosk mode entered)
 * - sessionEnd: Player unmount (exited Play/Kiosk mode)
 * - sceneEnter: Navigated to a scene (includes home scene on load)
 * - sceneExit: Leaving a scene (duration = time spent)
 *
 * Interactions:
 * - elementTap: User tapped an element
 * - elementHover: Mouse entered element (desktop only)
 * - elementPress: Long press started
 * - elementRelease: Long press ended
 * - actionRun: Interaction action executed (any action type)
 *
 * Media:
 * - videoPlay: Video playback started
 * - videoPause: Video paused
 * - videoComplete: Video reached end
 * - videoSeek: Playback position changed
 * - audioPlay: Audio playback started
 * - audioPause: Audio paused
 * - audioComplete: Audio reached end
 */
export type EventKind =
  // Data
  | "dataChanged"
  | "dataError"
  // Navigation
  | "sessionStart"
  | "sessionEnd"
  | "sceneEnter"
  | "sceneExit"
  // Interactions
  | "elementTap"
  | "elementHover"
  | "elementPress"
  | "elementRelease"
  | "actionRun"
  // Media
  | "videoPlay"
  | "videoPause"
  | "videoComplete"
  | "videoSeek"
  | "audioPlay"
  | "audioPause"
  | "audioComplete";

/**
 * Base event shape for all kiosk events. EventBus auto-injects timestamp,
 * sessionId, and sceneId if not provided by emitter.
 *
 * Payload is kind-specific flexible data. Common payload fields by kind:
 *
 * - sceneEnter: { sceneId, sceneName }
 * - sceneExit: { sceneId, sceneName, duration }
 * - elementTap: { elementId, elementType, sceneId }
 * - actionRun: { actionType, params, elementId }
 * - videoPlay: { elementId, currentTime }
 * - videoComplete: { elementId, duration }
 * - dataChanged: { sourceId, value }
 * - dataError: { sourceId, error }
 */
export interface KioskEvent {
  /** Event discriminator */
  kind: EventKind;

  /** Epoch milliseconds (auto-injected by EventBus if missing) */
  timestamp: number;

  /** Current play session ID (auto-injected by EventBus) */
  sessionId: string;

  /** Active scene ID (auto-injected by EventBus, always present) */
  sceneId: string;

  /** Kind-specific event data */
  payload: Record<string, unknown>;
}

/** EventBus subscriber callback */
export type EventListener = (event: KioskEvent) => void;

/** Unsubscribe function returned by subscribe() */
export type Unsubscribe = () => void;
