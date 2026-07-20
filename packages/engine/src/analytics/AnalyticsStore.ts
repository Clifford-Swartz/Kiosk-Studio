import type {
  CsvConnectorDef,
  ConsoleConnectorDef,
  DataConnectorDef,
  JsonConnectorDef,
  JsonlConnectorDef,
  RestConnectorDef,
} from "../model/types.js";
import type { EventKind, KioskEvent, Unsubscribe } from "../events/events.js";
import { eventBus } from "../events/EventBus.js";
import { toCSV, toJSON, toJSONL, toConsoleCompact } from "./formatters.js";

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
  private flushSink(sink: DataConnectorDef): void {
    const buffer = this.buffers.get(sink.id);
    if (!buffer || buffer.length === 0) return;

    const events = [...buffer]; // Copy before clearing
    this.buffers.set(sink.id, []); // Clear buffer

    switch (sink.kind) {
      case "csv":
        this.exportCSV(sink, events);
        break;
      case "json":
        this.exportJSON(sink, events);
        break;
      case "jsonl":
        this.exportJSONL(sink, events);
        break;
      case "rest":
        this.exportREST(sink, events);
        break;
      case "console":
        this.exportConsole(sink, events);
        break;
    }
  }

  /**
   * Export to CSV file via IPC (main process fs write).
   */
  private exportCSV(sink: CsvConnectorDef, events: KioskEvent[]): void {
    const csv = toCSV(events);
    const path = sink.output.path;
    const append = sink.output.appendMode;

    // IPC call to main process
    if (window.kiosk?.writeAnalytics) {
      window.kiosk.writeAnalytics(path, csv, append).catch((err: unknown) => {
        console.error(`[AnalyticsStore] CSV write failed (${path}):`, err);
      });
    }
  }

  /**
   * Export to JSON file via IPC.
   */
  private exportJSON(sink: JsonConnectorDef, events: KioskEvent[]): void {
    const json = toJSON(events);
    const path = sink.output.path;

    if (window.kiosk?.writeAnalytics) {
      window.kiosk.writeAnalytics(path, json, false).catch((err: unknown) => {
        console.error(`[AnalyticsStore] JSON write failed (${path}):`, err);
      });
    }
  }

  /**
   * Export to JSONL file via IPC (append mode).
   */
  private exportJSONL(sink: JsonlConnectorDef, events: KioskEvent[]): void {
    const jsonl = toJSONL(events);
    const path = sink.output.path;
    const append = sink.output.appendMode;

    if (window.kiosk?.writeAnalytics) {
      window.kiosk.writeAnalytics(path, jsonl, append).catch((err: unknown) => {
        console.error(`[AnalyticsStore] JSONL write failed (${path}):`, err);
      });
    }
  }

  /**
   * Export to REST endpoint via POST (batch array).
   */
  private exportREST(sink: RestConnectorDef, events: KioskEvent[]): void {
    const url = sink.output!.url;

    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(events),
      signal: AbortSignal.timeout(10000), // 10s timeout
    }).catch((err) => {
      console.error(`[AnalyticsStore] REST POST failed (${url}):`, err);
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
  }

  /**
   * Flush all sinks immediately. Called on sessionEnd.
   */
  flushAll(connectors: DataConnectorDef[]): void {
    const sinks = connectors.filter((c) => c.output && c.output.enabled);
    for (const sink of sinks) {
      this.flushSink(sink);
    }
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

/** Singleton AnalyticsStore instance */
export const analyticsStore = new AnalyticsStoreImpl();
