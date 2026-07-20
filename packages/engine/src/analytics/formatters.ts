import type { KioskEvent } from "../events/events.js";

/**
 * CSV formatter: flattened columns (timestamp, sessionId, sceneId, kind, + sparse optional fields).
 * Common columns: elementId, elementType, duration, actionType, sourceId, error.
 * Nested objects (value field) JSON.stringify.
 */
export function toCSV(events: KioskEvent[]): string {
  if (events.length === 0) return "";

  // Header row
  const header =
    "timestamp,sessionId,sceneId,kind,elementId,elementType,duration,actionType,sourceId,value,error\n";

  // Data rows
  const rows = events.map((e) => {
    const p = e.payload;
    const elementId = p.elementId ?? "";
    const elementType = p.elementType ?? "";
    const duration = p.duration ?? "";
    const actionType = p.actionType ?? "";
    const sourceId = p.sourceId ?? "";
    const error = p.error ?? "";

    // JSON.stringify nested objects in value column
    let value = "";
    if (p.value !== undefined) {
      value =
        typeof p.value === "object" && p.value !== null
          ? JSON.stringify(p.value).replace(/"/g, '""') // escape quotes for CSV
          : String(p.value);
    }

    return `${new Date(e.timestamp).toISOString()},${e.sessionId},${e.sceneId},${e.kind},${elementId},${elementType},${duration},${actionType},${sourceId},"${value}",${error}`;
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
