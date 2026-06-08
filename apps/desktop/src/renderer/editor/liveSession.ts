import { useEffect } from "react";
import { bindingStore } from "@kiosk/engine";
import { useEditor } from "./store.js";

/**
 * Runs a live data session: starts connectors for the project's data sources
 * (via IPC to the main process) and pipes pushed values into the engine's
 * bindingStore so bound elements update. Re-starts whenever the set of sources
 * or their configs change. Used by both the editor (canvas preview) and player.
 */
export function useLiveSession(): void {
  const dataSources = useEditor((s) => s.project.dataSources);
  // Re-run when the sources' identity/config changes (stringify is fine — small).
  const key = JSON.stringify(dataSources.map((d) => ({ id: d.id, kind: d.kind, config: d.config })));

  useEffect(() => {
    const unsub = window.kiosk.onDataValue((v) => bindingStore.setValue(v.sourceId, v.value));
    if (dataSources.length > 0) {
      void window.kiosk.startData(
        dataSources.map((d) => ({ id: d.id, kind: d.kind, config: d.config }))
      );
    } else {
      void window.kiosk.stopData();
    }
    return () => {
      unsub();
      void window.kiosk.stopData();
      bindingStore.reset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
