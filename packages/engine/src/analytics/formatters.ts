import type { KioskEvent } from "../events/events.js";

/** Resolves scene/element ids to their author-facing names, for CSV export. */
export interface NameResolver {
  sceneName(id: string): string;
  elementName(id: string): string;
}

const IDENTITY_RESOLVER: NameResolver = {
  sceneName: (id) => id,
  elementName: (id) => id,
};

/**
 * CSV formatter: flattened columns (timestamp, sessionId, scene, sceneState, kind, + sparse optional fields).
 * Common columns: element, elementType, duration, actionType, sourceId, error.
 * Nested objects (value field) JSON.stringify.
 *
 * Column notes:
 * - scene/element show author-assigned names (falling back to id if unnamed), not raw ids.
 * - sceneState is the active scene state (set via the setState action) at the time of the event;
 *   empty means the default state.
 * - duration's unit depends on kind: milliseconds for sceneExit/stateExit (time spent in scene/state),
 *   seconds for videoComplete/audioComplete (media length), matching the source APIs each is read from.
 * - sourceId identifies the input data connector that produced a dataChanged/dataError event
 *   (distinct from output sinks) — see the Sources tab in the Data connectors panel.
 */
// Wraps a field in quotes and escapes embedded quotes if it contains a comma, quote, or newline.
function csvField(value: unknown): string {
  const s = value === undefined || value === null ? "" : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCSV(
  events: KioskEvent[],
  names: NameResolver = IDENTITY_RESOLVER,
  includeHeader = true
): string {
  if (events.length === 0) return "";

  // Header row — omitted when appending more rows from the same session as
  // the file's existing content, so the header doesn't repeat every flush.
  const header = includeHeader
    ? "timestamp,sessionId,scene,sceneState,kind,element,elementType,duration,actionType,sourceId,value,error\n"
    : "";

  // Data rows
  const rows = events.map((e) => {
    const p = e.payload;

    // JSON.stringify nested objects in value column
    let value: unknown = "";
    if (p.value !== undefined) {
      value = typeof p.value === "object" && p.value !== null ? JSON.stringify(p.value) : p.value;
    }

    const elementName = p.elementId !== undefined ? names.elementName(String(p.elementId)) : "";

    return [
      new Date(e.timestamp).toISOString(),
      e.sessionId,
      names.sceneName(e.sceneId),
      e.sceneState ?? "",
      e.kind,
      elementName,
      p.elementType,
      p.duration,
      p.actionType,
      p.sourceId,
      value,
      p.error,
    ]
      .map(csvField)
      .join(",");
  });

  return header + rows.join("\n");
}

/**
 * JSON formatter: array of events as JSON.
 */
export function toJSON(events: KioskEvent[]): string {
  return JSON.stringify(events, null, 2);
}

/**
 * JSONL formatter: one JSON object per line (newline-delimited).
 */
export function toJSONL(events: KioskEvent[]): string {
  return events.map((e) => JSON.stringify(e)).join("\n");
}

/**
 * Console compact formatter: one-liner per event.
 * Format: [kind] sceneId elementId? (timestamp)
 */
export function toConsoleCompact(event: KioskEvent): string {
  const elementId = event.payload.elementId ? ` ${event.payload.elementId}` : "";
  const ts = new Date(event.timestamp).toISOString().slice(11, 23); // HH:MM:SS.sss
  return `[${event.kind}] ${event.sceneId}${elementId} (${ts})`;
}
