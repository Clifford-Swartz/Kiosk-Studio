import React from "react";
import type { UpdateStatus } from "../../preload/index.js";
import { useEditor } from "./store.js";

/**
 * TopBar icon + popover for app updates: shows the running version, whether a
 * newer GitHub release exists, the one action that makes sense right now
 * (check / download / restart), and the auto-update toggle.
 *
 * The main process owns all updater state and pushes it here, so this
 * component keeps a single status object and never derives its own.
 */
export function UpdateButton() {
  const [status, setStatus] = React.useState<UpdateStatus | null>(null);
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const dirty = useEditor((s) => s.dirty);

  React.useEffect(() => {
    let alive = true;
    void window.kiosk.getUpdateStatus().then((s) => {
      if (alive) setStatus(s);
    });
    const off = window.kiosk.onUpdateStatus(setStatus);
    return () => {
      alive = false;
      off();
    };
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!status) return null;

  const { state, latestVersion, canInstall } = status;
  const pending = state === "available" || state === "downloading" || state === "ready";
  const accent = state === "ready" ? "#22c55e" : state === "error" ? "#ef4444" : "#f59e0b";

  const message =
    state === "checking" ? "Checking for updates…"
    : state === "up-to-date" ? "You're up to date"
    : state === "available" ? `Version ${latestVersion} is available`
    : state === "downloading" ? `Downloading ${latestVersion}… ${status.percent ?? 0}%`
    : state === "ready" ? `Version ${latestVersion} is ready to install`
    : state === "error" ? status.error ?? "Update failed"
    : "Not checked yet";

  const restart = () => {
    if (dirty && !window.confirm("You have unsaved changes that will be lost. Restart and update anyway?")) return;
    void window.kiosk.installUpdate();
  };

  const action: { label: string; run: () => void; primary?: boolean } | null =
    state === "ready" ? { label: "Restart to update", run: restart, primary: true }
    : state === "available" && canInstall
      ? { label: "Download update", run: () => void window.kiosk.downloadUpdate(), primary: true }
    : state === "available" ? { label: "View release", run: () => void window.kiosk.openReleasePage(), primary: true }
    : state === "downloading" || state === "checking" ? null
    : { label: "Check for updates", run: () => void window.kiosk.checkForUpdates() };

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        style={{ ...iconBtn, opacity: pending || open ? 1 : 0.7 }}
        onClick={() => setOpen((v) => !v)}
        title={pending ? message : `Updates (v${status.currentVersion})`}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M3 13h10" />
        </svg>
        {(pending || state === "error") && <span style={{ ...dot, background: accent }} />}
      </button>

      {open && (
        <div style={popover}>
          <div style={{ fontWeight: 600, color: "#e2e8f0" }}>Kiosk Studio v{status.currentVersion}</div>
          <div style={{ color: state === "error" ? "#fca5a5" : "#94a3b8", fontSize: 12, marginTop: 4 }}>{message}</div>

          {state === "downloading" && (
            <div style={track}>
              <div style={{ ...fill, width: `${status.percent ?? 0}%` }} />
            </div>
          )}

          {action && (
            <button style={{ ...actionBtn, ...(action.primary ? primaryBtn : {}) }} onClick={action.run}>
              {action.label}
            </button>
          )}

          <label style={toggleRow} title="Download new versions in the background and install them when the app closes">
            <input
              type="checkbox"
              checked={status.autoUpdate}
              onChange={(e) => void window.kiosk.setAutoUpdate(e.target.checked).then(setStatus)}
            />
            <span>Update automatically</span>
          </label>
          {state === "ready" && (
            <div style={{ color: "#64748b", fontSize: 11, marginTop: 6 }}>Installs on its own the next time the app closes.</div>
          )}
        </div>
      )}
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  position: "relative",
  background: "#2c3647",
  border: "1px solid #232c3a",
  borderRadius: 6,
  color: "#e2e8f0",
  padding: "6px 12px",
  cursor: "pointer",
  minWidth: 40,
  height: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
const dot: React.CSSProperties = {
  position: "absolute",
  top: 4,
  right: 4,
  width: 8,
  height: 8,
  borderRadius: "50%",
};
const popover: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 6px)",
  right: 0,
  width: 240,
  padding: 12,
  background: "#131a24",
  border: "1px solid #232c3a",
  borderRadius: 8,
  boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
  fontSize: 13,
  zIndex: 1000,
};
const track: React.CSSProperties = {
  height: 4,
  borderRadius: 2,
  background: "#232c3a",
  marginTop: 8,
  overflow: "hidden",
};
const fill: React.CSSProperties = { height: "100%", background: "#3b82f6" };
const actionBtn: React.CSSProperties = {
  width: "100%",
  marginTop: 10,
  background: "#1d2430",
  border: "1px solid #232c3a",
  borderRadius: 6,
  color: "#e2e8f0",
  fontSize: 13,
  padding: "6px 10px",
  cursor: "pointer",
};
const primaryBtn: React.CSSProperties = { background: "#3b5da5", borderColor: "#1a274b", color: "#fff", fontWeight: 600 };
const toggleRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginTop: 12,
  paddingTop: 10,
  borderTop: "1px solid #232c3a",
  color: "#cbd5e1",
  fontSize: 12,
  cursor: "pointer",
};
