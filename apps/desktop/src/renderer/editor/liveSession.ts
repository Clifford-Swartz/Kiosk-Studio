import { useEffect } from "react";
import { eventBus, isRestConnector } from "@kiosk/engine";
import { useEditor } from "./store.js";

/**
 * Runs a live data session: starts connectors for the project's data connectors
 * (via IPC to the main process) and bridges IPC events to the EventBus.
 * Re-starts whenever the set of connectors or their configs change.
 * Used by both the editor (canvas preview) and player.
 */
export function useLiveSession(): void {
  const dataConnectors = useEditor((s) => s.project.dataConnectors || []);
  // Filter to input-enabled connectors for IPC startData
  const inputSources = dataConnectors.filter(isRestConnector).filter((c) => c.input?.enabled);
  // Re-run when the sources' identity/config changes (stringify is fine — small).
  const key = JSON.stringify(inputSources.map((c) => ({ id: c.id, kind: c.kind, url: c.input!.url, intervalMs: c.input!.intervalMs })));

  useEffect(() => {
    // Bridge IPC events to EventBus
    const unsub = window.kiosk.onEvent((event) => {
      eventBus.emit({
        kind: event.kind as any,
        payload: event.payload,
        timestamp: event.timestamp,
        sessionId: event.sessionId,
        sceneId: event.sceneId
      });
    });

    if (inputSources.length > 0) {
      void window.kiosk.startData(
        inputSources.map((c) => ({
          id: c.id,
          kind: c.kind,
          config: { url: c.input!.url, intervalMs: c.input!.intervalMs },
        }))
      );
    } else {
      void window.kiosk.stopData();
    }

    return () => {
      unsub();
      void window.kiosk.stopData();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
