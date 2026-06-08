import { useCallback, useEffect, useRef, useState } from "react";
import { Player, type Project } from "@kiosk/engine";
import { projectAssetBase } from "../editor/assets.js";

/**
 * Fullscreen kiosk runtime: renders the Player for a public touch screen.
 * - cursor hidden (revealed briefly on movement)
 * - idle "attract" reset: after N seconds of no input, return to the start scene
 * - exit: press Esc (or call onExit) to leave
 * The Player already scales the scene to fit the window, so in a true-fullscreen
 * window it fills the screen edge-to-edge.
 *
 * The live data session is started by the App (useLiveSession), so we don't
 * start another one here.
 */
export function KioskRuntime({
  project,
  filePath,
  onExit,
  idleResetMs = 60000,
}: {
  project: Project;
  filePath: string | null;
  onExit: () => void;
  idleResetMs?: number;
}) {
  const [cursorVisible, setCursorVisible] = useState(false);
  // Remount key forces the Player back to its start scene on idle reset.
  const [resetKey, setResetKey] = useState(0);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cursorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const armIdle = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setResetKey((k) => k + 1), idleResetMs);
  }, [idleResetMs]);

  useEffect(() => {
    armIdle();
    const onActivity = () => {
      armIdle();
      // Briefly reveal the cursor on movement, then hide again.
      setCursorVisible(true);
      if (cursorTimer.current) clearTimeout(cursorTimer.current);
      cursorTimer.current = setTimeout(() => setCursorVisible(false), 2000);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
    };
    window.addEventListener("pointerdown", onActivity);
    window.addEventListener("pointermove", onActivity);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("pointermove", onActivity);
      window.removeEventListener("keydown", onKey);
      if (idleTimer.current) clearTimeout(idleTimer.current);
      if (cursorTimer.current) clearTimeout(cursorTimer.current);
    };
  }, [armIdle, onExit]);

  return (
    <div style={{ position: "absolute", inset: 0, background: "#000", cursor: cursorVisible ? "default" : "none" }}>
      <Player key={resetKey} project={project} assetBaseUrl={projectAssetBase(filePath)} />
    </div>
  );
}
