import React, { useEffect, useState } from "react";

export interface VideoControlsProps {
  video: HTMLVideoElement | null;
}

const SPEEDS = [0.5, 1, 1.5, 2];

/**
 * Minimal always-visible chrome for a video element: play/pause, scrub bar,
 * speed cycle. Manipulates the given `HTMLVideoElement` directly and mirrors
 * its native events, so it stays in sync with playback driven by anything
 * else (autoplay, an author-wired interaction, etc.).
 */
export function VideoControls({ video }: VideoControlsProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (!video) return;

    setIsPlaying(!video.paused);
    setPlaybackRate(video.playbackRate);
    setCurrentTime(video.currentTime);
    setDuration(video.duration || 0);

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onRateChange = () => setPlaybackRate(video.playbackRate);
    const onTimeUpdate = () => setCurrentTime(video.currentTime);
    const onDurationChange = () => setDuration(video.duration || 0);

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ratechange", onRateChange);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("durationchange", onDurationChange);

    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ratechange", onRateChange);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("durationchange", onDurationChange);
    };
  }, [video]);

  if (!video) return null;

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  const togglePlay = () => {
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  };

  const cycleSpeed = () => {
    const idx = SPEEDS.indexOf(playbackRate);
    video.playbackRate = SPEEDS[(idx + 1) % SPEEDS.length] ?? 1;
  };

  return (
    <div
      onClick={stop}
      onPointerDown={stop}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 52,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0 10px",
        background: "rgba(0, 0, 0, 0.45)",
        zIndex: 20,
      }}
    >
      <button
        onClick={togglePlay}
        title={isPlaying ? "Pause" : "Play"}
        style={{
          background: "none",
          border: "none",
          color: "#fff",
          fontSize: 48,
          cursor: "pointer",
          padding: 0,
          width: 58,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {isPlaying ? "❙❙" : "▶"}
      </button>

      <input
        type="range"
        min={0}
        max={duration || 0}
        step={0.1}
        value={Math.min(currentTime, duration || 0)}
        onChange={(e) => {
          video.currentTime = Number(e.target.value);
        }}
        style={{ flex: 1, height: 25, cursor: "pointer" }}
      />

      <button
        onClick={cycleSpeed}
        title="Playback speed"
        style={{
          background: "none",
          border: "none",
          color: "#fff",
          fontSize: 42,
          cursor: "pointer",
          padding: 0,
          minWidth: 68,
        }}
      >
        {playbackRate}x
      </button>
    </div>
  );
}
