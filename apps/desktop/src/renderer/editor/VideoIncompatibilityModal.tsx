import React, { useEffect, useState } from "react";
import { useEditor } from "./store.js";

/**
 * Modal shown whenever a video's codec can't be decoded by Chromium's
 * <video> element (import-time probe in assets.ts, or a runtime playback
 * error surfaced by VideoElement via Canvas.tsx). Offers to re-encode the
 * file to H.264/AAC via the bundled ffmpeg, import it anyway (in case the
 * probe is wrong, or the user wants to fix it later), or cancel.
 */
export function VideoIncompatibilityModal() {
  const pending = useEditor((s) => s.videoIncompatibility);
  const setVideoIncompatibility = useEditor((s) => s.setVideoIncompatibility);
  const [encoding, setEncoding] = useState(false);
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Reset transient UI state each time a new incompatibility is opened.
  useEffect(() => {
    setEncoding(false);
    setPercent(0);
    setError(null);
  }, [pending?.relativePath]);

  useEffect(() => {
    if (!encoding || !pending) return;
    return window.kiosk.onEvent((event) => {
      if (event.kind !== "encodeProgress") return;
      const payload = event.payload as { relativePath?: string; percent?: number };
      if (payload.relativePath === pending.relativePath && typeof payload.percent === "number") {
        setPercent(payload.percent);
      }
    });
  }, [encoding, pending]);

  if (!pending) return null;

  const codecLabel = pending.videoCodec ? `"${pending.videoCodec}"` : "an unknown codec";

  const finish = (relativePath: string | null) => {
    pending.resolve(relativePath);
    setVideoIncompatibility(null);
  };

  const handleReencode = async () => {
    setEncoding(true);
    setError(null);
    try {
      const newPath = await window.kiosk.reencodeVideo(pending.projectPath, pending.relativePath);
      finish(newPath);
    } catch (err) {
      setEncoding(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div style={overlay}>
      <div style={modal}>
        <h2 style={title}>Video format not supported</h2>
        <p style={body}>
          <strong>{pending.fileName}</strong> uses {codecLabel} video, which can't be played back
          in Kiosk Studio. Re-encoding converts it to H.264, which plays reliably everywhere.
        </p>
        {error && <p style={errorText}>Re-encode failed: {error}</p>}
        {encoding ? (
          <div style={{ marginTop: 8 }}>
            <div style={progressTrack}>
              <div style={{ ...progressFill, width: `${percent}%` }} />
            </div>
            <p style={progressLabel}>Re-encoding… {percent}%</p>
          </div>
        ) : (
          <div style={actions}>
            <button style={btn} onClick={() => finish(null)}>
              Cancel
            </button>
            <button style={btn} onClick={() => finish(pending.relativePath)}>
              Import Anyway
            </button>
            <button style={{ ...btn, background: "#2563eb", color: "#fff" }} onClick={handleReencode}>
              Re-encode &amp; Import
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: "rgba(0, 0, 0, 0.8)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999,
};

const modal: React.CSSProperties = {
  background: "#0e1218",
  border: "1px solid #1f2733",
  borderRadius: 12,
  width: 480,
  padding: 24,
};

const title: React.CSSProperties = {
  margin: "0 0 12px",
  fontSize: 16,
  color: "#e2e8f0",
};

const body: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  lineHeight: 1.5,
  color: "#94a3b8",
};

const errorText: React.CSSProperties = {
  marginTop: 12,
  fontSize: 13,
  color: "#fca5a5",
};

const actions: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
  marginTop: 20,
};

const btn: React.CSSProperties = {
  padding: "8px 16px",
  background: "#161c26",
  border: "1px solid #232c3a",
  borderRadius: 6,
  color: "#e2e8f0",
  fontSize: 13,
  cursor: "pointer",
};

const progressTrack: React.CSSProperties = {
  height: 8,
  borderRadius: 4,
  background: "#161c26",
  overflow: "hidden",
};

const progressFill: React.CSSProperties = {
  height: "100%",
  background: "#2563eb",
  transition: "width 0.2s ease",
};

const progressLabel: React.CSSProperties = {
  margin: "8px 0 0",
  fontSize: 12,
  color: "#94a3b8",
};
