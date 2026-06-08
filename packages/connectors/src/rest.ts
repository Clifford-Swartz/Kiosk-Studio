import type { Connector, ConnectorFactory, EmitFn, SourceSpec } from "./types.js";

/**
 * REST polling connector. Config:
 *   { url: string; intervalMs?: number }  (default 5000ms, min 250ms)
 * Fetches the URL on an interval, parses JSON (falls back to text), and emits
 * the parsed value. Emits immediately on start, then on each interval. Errors
 * are emitted as `{ __error: message }` so the UI can surface them.
 *
 * Relies on a global `fetch` (available in Electron 31 main + modern Node).
 */
function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export const createRestConnector: ConnectorFactory = (
  spec: SourceSpec,
  emit: EmitFn
): Connector => {
  const url = str(spec.config.url);
  const intervalMs = Math.max(250, num(spec.config.intervalMs, 5000));
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  async function poll() {
    if (stopped || !url) return;
    try {
      const res = await fetch(url);
      const text = await res.text();
      let value: unknown = text;
      try {
        value = JSON.parse(text);
      } catch {
        /* not JSON — keep raw text */
      }
      if (!stopped) emit({ sourceId: spec.id, value, at: Date.now() });
    } catch (err) {
      if (!stopped)
        emit({
          sourceId: spec.id,
          value: { __error: err instanceof Error ? err.message : String(err) },
          at: Date.now(),
        });
    }
  }

  return {
    start() {
      stopped = false;
      void poll(); // fire immediately
      timer = setInterval(poll, intervalMs);
    },
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
};
