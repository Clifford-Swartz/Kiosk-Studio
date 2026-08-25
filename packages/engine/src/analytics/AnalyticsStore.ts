import type {
  CsvConnectorDef,
  ConsoleConnectorDef,
  DataConnectorDef,
  Element,
  JsonConnectorDef,
  JsonlConnectorDef,
  Project,
  RestConnectorDef,
} from "../model/types.js";
import type { EventKind, KioskEvent, Unsubscribe } from "../events/events.js";
import { eventBus } from "../events/EventBus.js";
import { toCSV, toJSON, toJSONL, toConsoleCompact, type NameResolver } from "./formatters.js";

function collectElementNames(elements: Element[], into: Map<string, string>): void {
  for (const el of elements) {
    if (el.name) into.set(el.id, el.name);
    if (el.children) collectElementNames(el.children, into);
  }
}

/** Builds scene/element id -> name lookups from the current project, for CSV export. */
function buildNameResolver(project: Project | null): NameResolver {
  const sceneNames = new Map<string, string>();
  const elementNames = new Map<string, string>();

  if (project) {
    for (const scene of project.scenes) {
      sceneNames.set(scene.id, scene.name);
      collectElementNames(scene.elements, elementNames);
    }
  }

  return {
    sceneName: (id) => sceneNames.get(id) ?? id,
    elementName: (id) => elementNames.get(id) ?? id,
  };
}

/** Per-sink export status, surfaced in the editor's Sinks panel. */
export interface SinkStatus {
  state: "idle" | "ok" | "error";
  message?: string;
  lastFlushAt?: number;
}

/**
 * Analytics store: buffers kiosk events per sink, flushes to export destinations.
 * Supports CSV/JSON/JSONL file export, REST POST, and console logging.
 *
 * Buffering strategy:
 * - Per-sink buffers (Map<sinkId, KioskEvent[]>)
 * - Flush triggers: timer (per sink) OR size limit OR manual (sessionEnd)
 * - Subscription optimization: one EventBus subscription per unique event kind,
 *   fan out to multiple sink buffers
 */
class AnalyticsStoreImpl {
  private buffers = new Map<string, KioskEvent[]>();
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private unsubs: Unsubscribe[] = [];
  private statuses: Record<string, SinkStatus> = {};
  private statusListeners = new Set<() => void>();
  private project: Project | null = null;
  /** Last sessionId successfully written to each CSV sink, so a header isn't re-emitted mid-session. */
  private lastCsvSessionId = new Map<string, string>();

  /**
   * Keep the current project reference fresh for CSV name resolution (scene/element
   * names can change from editor edits without a new Player session starting).
   */
  setProject(project: Project | null): void {
    this.project = project;
  }

  /** Subscribe to sink status changes (for useSyncExternalStore in the editor UI). */
  subscribeStatus(listener: () => void): Unsubscribe {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** Snapshot of all sink statuses, keyed by sink id. Stable reference until next update. */
  getStatusSnapshot(): Record<string, SinkStatus> {
    return this.statuses;
  }

  private setStatus(sinkId: string, status: SinkStatus): void {
    this.statuses = { ...this.statuses, [sinkId]: status };
    for (const listener of this.statusListeners) listener();
  }

  /**
   * Initialize analytics with output sinks from project data connectors.
   * Call on Player mount or when project dataConnectors change.
   */
  init(connectors: DataConnectorDef[]): void {
    this.stop(); // Clear previous session

    // Filter to output-enabled connectors
    const sinks = connectors.filter(
      (c) => c.output && c.output.enabled
    ) as Array<
      RestConnectorDef | CsvConnectorDef | JsonConnectorDef | JsonlConnectorDef | ConsoleConnectorDef
    >;

    if (sinks.length === 0) return;

    // Initialize buffers
    for (const sink of sinks) {
      this.buffers.set(sink.id, []);
    }

    // Collect unique event kinds across all sinks
    const kindToSinks = new Map<EventKind, string[]>();
    for (const sink of sinks) {
      if (!sink.output) continue; // Type guard: all filtered sinks have output
      for (const kind of sink.output.events) {
        if (!kindToSinks.has(kind)) {
          kindToSinks.set(kind, []);
        }
        kindToSinks.get(kind)!.push(sink.id);
      }
    }

    // Subscribe once per unique event kind, fan out to sink buffers
    for (const [kind, sinkIds] of kindToSinks) {
      const unsub = eventBus.subscribe(kind, (event) => {
        for (const sinkId of sinkIds) {
          const buffer = this.buffers.get(sinkId);
          if (buffer) {
            buffer.push(event);
            this.checkFlush(sinkId, sinks.find((s) => s.id === sinkId)!);
          }
        }
      });
      this.unsubs.push(unsub);
    }

    // Start flush timers for time-based sinks
    for (const sink of sinks) {
      if (sink.kind === "console") continue; // console logs immediately, no timer

      const intervalMs =
        sink.kind === "rest"
          ? 30000 // REST: default 30s (no config field)
          : sink.output.flushIntervalMs;

      const timer = setInterval(() => {
        this.flushSink(sink);
      }, intervalMs);

      this.timers.set(sink.id, timer);
    }
  }

  /**
   * Check if sink buffer hit size limit, flush if so.
   */
  private checkFlush(sinkId: string, sink: DataConnectorDef): void {
    const buffer = this.buffers.get(sinkId);
    if (!buffer) return;

    const maxSize =
      sink.kind === "rest"
        ? sink.output!.batchSize
        : sink.kind === "console"
          ? sink.output.maxEvents
          : sink.output!.maxBufferSize;

    if (buffer.length >= maxSize) {
      this.flushSink(sink);
    }
  }

  /**
   * Flush one sink's buffer to its export destination.
   */
  private flushSink(sink: DataConnectorDef): Promise<void> {
    const buffer = this.buffers.get(sink.id);
    if (!buffer || buffer.length === 0) return Promise.resolve();

    const events = [...buffer]; // Copy before clearing
    this.buffers.set(sink.id, []); // Clear buffer

    switch (sink.kind) {
      case "csv":
        return this.exportCSV(sink, events);
      case "json":
        return this.exportJSON(sink, events);
      case "jsonl":
        return this.exportJSONL(sink, events);
      case "rest":
        return this.exportREST(sink, events);
      case "console":
        this.exportConsole(sink, events);
        return Promise.resolve();
      default:
        return Promise.resolve();
    }
  }

  /**
   * Export to CSV file via IPC (main process fs write).
   */
  private exportCSV(sink: CsvConnectorDef, events: KioskEvent[]): Promise<void> {
    const path = sink.output.path;
    const append = sink.output.appendMode;

    // Only suppress the header when appending onto rows from this same session —
    // a new session (or overwrite mode) should always get a fresh header.
    const sessionId = events[0]?.sessionId;
    const includeHeader = !(append && this.lastCsvSessionId.get(sink.id) === sessionId);
    const csv = toCSV(events, buildNameResolver(this.project), includeHeader);

    // Recorded synchronously (before the write's promise settles), not in .then():
    // concurrent flushes of the same sink (e.g. a timer flush racing the end-of-session
    // flush) must see each other's decision immediately, or both read the stale tracker
    // and both conclude a header is needed.
    if (sessionId) this.lastCsvSessionId.set(sink.id, sessionId);

    // IPC call to main process
    if (window.kiosk?.writeAnalytics) {
      return window.kiosk
        .writeAnalytics(path, csv, append)
        .then((result) => {
          this.handleWriteResult(sink.id, path, "CSV", result);
        })
        .catch((err: unknown) => {
          console.error(`[AnalyticsStore] CSV write failed (${path}):`, err);
          this.setStatus(sink.id, { state: "error", message: errorMessage(err) });
        });
    } else {
      this.setStatus(sink.id, { state: "error", message: "writeAnalytics bridge unavailable" });
      return Promise.resolve();
    }
  }

  /** Interprets the IPC write result — a resolved promise can still carry success:false. */
  private handleWriteResult(
    sinkId: string,
    path: string,
    label: string,
    result: { success: boolean; error?: string }
  ): void {
    if (result.success) {
      this.setStatus(sinkId, { state: "ok", lastFlushAt: Date.now() });
    } else {
      console.error(`[AnalyticsStore] ${label} write rejected (${path}):`, result.error);
      this.setStatus(sinkId, { state: "error", message: result.error ?? "write rejected" });
    }
  }

  /**
   * Export to JSON file via IPC.
   */
  private exportJSON(sink: JsonConnectorDef, events: KioskEvent[]): Promise<void> {
    const json = toJSON(events);
    const path = sink.output.path;

    if (window.kiosk?.writeAnalytics) {
      return window.kiosk
        .writeAnalytics(path, json, false)
        .then((result) => this.handleWriteResult(sink.id, path, "JSON", result))
        .catch((err: unknown) => {
          console.error(`[AnalyticsStore] JSON write failed (${path}):`, err);
          this.setStatus(sink.id, { state: "error", message: errorMessage(err) });
        });
    } else {
      this.setStatus(sink.id, { state: "error", message: "writeAnalytics bridge unavailable" });
      return Promise.resolve();
    }
  }

  /**
   * Export to JSONL file via IPC (append mode).
   */
  private exportJSONL(sink: JsonlConnectorDef, events: KioskEvent[]): Promise<void> {
    const jsonl = toJSONL(events);
    const path = sink.output.path;
    const append = sink.output.appendMode;

    if (window.kiosk?.writeAnalytics) {
      return window.kiosk
        .writeAnalytics(path, jsonl, append)
        .then((result) => this.handleWriteResult(sink.id, path, "JSONL", result))
        .catch((err: unknown) => {
          console.error(`[AnalyticsStore] JSONL write failed (${path}):`, err);
          this.setStatus(sink.id, { state: "error", message: errorMessage(err) });
        });
    } else {
      this.setStatus(sink.id, { state: "error", message: "writeAnalytics bridge unavailable" });
      return Promise.resolve();
    }
  }

  /**
   * Export to REST endpoint via POST (batch array).
   */
  private exportREST(sink: RestConnectorDef, events: KioskEvent[]): Promise<void> {
    const url = sink.output!.url;

    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(events),
      signal: AbortSignal.timeout(10000), // 10s timeout
    })
      .then((res) => {
        if (res.ok) {
          this.setStatus(sink.id, { state: "ok", lastFlushAt: Date.now() });
        } else {
          console.error(`[AnalyticsStore] REST POST rejected (${url}): HTTP ${res.status}`);
          this.setStatus(sink.id, { state: "error", message: `HTTP ${res.status}` });
        }
      })
      .catch((err) => {
        console.error(`[AnalyticsStore] REST POST failed (${url}):`, err);
        this.setStatus(sink.id, { state: "error", message: errorMessage(err) });
      });
  }

  /**
   * Export to browser console (immediate, no buffer).
   */
  private exportConsole(sink: ConsoleConnectorDef, events: KioskEvent[]): void {
    const format = sink.output.format;

    switch (format) {
      case "table":
        console.table(events.map((e) => ({ ...e, payload: JSON.stringify(e.payload) })));
        break;
      case "json":
        console.log(JSON.stringify(events, null, 2));
        break;
      case "compact":
        for (const event of events) {
          console.log(toConsoleCompact(event));
        }
        break;
    }

    // Trim buffer to maxEvents limit (circular buffer)
    const buffer = this.buffers.get(sink.id);
    if (buffer && buffer.length > sink.output.maxEvents) {
      buffer.splice(0, buffer.length - sink.output.maxEvents);
    }

    this.setStatus(sink.id, { state: "ok", lastFlushAt: Date.now() });
  }

  /**
   * Flush all sinks immediately, resolving once every export has settled.
   * Called on sessionEnd, and awaited before quitting a launched kiosk so
   * buffered events aren't lost to a process exit racing the flush.
   */
  flushAll(connectors: DataConnectorDef[]): Promise<void> {
    const sinks = connectors.filter((c) => c.output && c.output.enabled);
    return Promise.all(sinks.map((sink) => this.flushSink(sink))).then(() => undefined);
  }

  /**
   * Stop analytics: clear timers, unsubscribe, reset buffers.
   * Call on Player unmount.
   */
  stop(): void {
    // Clear timers
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();

    // Unsubscribe from EventBus
    for (const unsub of this.unsubs) {
      unsub();
    }
    this.unsubs = [];

    // Clear buffers
    this.buffers.clear();
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Singleton AnalyticsStore instance */
export const analyticsStore = new AnalyticsStoreImpl();
