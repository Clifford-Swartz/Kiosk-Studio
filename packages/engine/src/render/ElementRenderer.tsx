import React, { useEffect, useRef } from "react";
import type { Element } from "../model/types.js";
import { CollectionRenderer } from "./collections/CollectionRenderer.js";
import videojs from "video.js";
import "video.js/dist/video-js.css";

export interface ElementRendererProps {
  element: Element;
  /** Fired when an element with a `tap` interaction is activated. */
  onTap?: (element: Element) => void;
  /** Fired when an element with a `hover` interaction is entered. */
  onHover?: (element: Element) => void;
  /** Fired when an element with a `hoverEnd` interaction is left. */
  onHoverEnd?: (element: Element) => void;
  /**
   * Base URL for resolving relative asset `src` values (e.g. "assets/x.png").
   * Typically a `file://<projectDir>/` URL. Absolute URLs pass through.
   */
  assetBaseUrl?: string;
  /** True in the Player; enables time-based behavior (e.g. Ken Burns auto-advance). */
  playing?: boolean;
  /** Callback to register audio elements by ID for playback control. */
  onAudioRef?: (elementId: string, ref: HTMLAudioElement | null) => void;
  /** Callback to register video elements by ID for playback control. */
  onVideoRef?: (elementId: string, ref: HTMLVideoElement | null) => void;
}

// Embedded fallback: 1×1 transparent PNG data URI (for empty src fields)
const FALLBACK_DATA_URI = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

// Embedded placeholder: gray rectangle with "Image" text as SVG
const PLACEHOLDER_FALLBACK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='240' viewBox='0 0 320 240'%3E%3Crect width='320' height='240' fill='%2334495e'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-family='system-ui' font-size='24' fill='%2395a5a6'%3EImage%3C/text%3E%3C/svg%3E";

/**
 * Resolve an asset `src`. Absolute URLs (http/https/data/blob/file) and
 * protocol-relative URLs pass through unchanged; a relative path is joined to
 * `base` if provided (so saved projects can keep portable relative paths).
 *
 * Special handling:
 * - Empty string → transparent fallback (invisible but won't break layout)
 * - "__placeholder__" sentinel → bundled placeholder image
 */
export function resolveSrc(src: string, base?: string): string {
  if (!src) return FALLBACK_DATA_URI;

  // Sentinel value → bundled placeholder
  if (src === "__placeholder__") {
    return "app://placeholder.png";
  }

  // Absolute URLs pass through
  if (/^([a-z]+:)?\/\//i.test(src) || src.startsWith("data:")) return src;

  // Relative paths → join with base
  if (!base) return src;
  return base.endsWith("/") ? base + src : `${base}/${src}`;
}

/**
 * Renders a single scene element as an absolutely-positioned DOM node using
 * CSS transforms. This is the shared rendering primitive used by both the
 * Player and (later) the Editor canvas.
 */
export function ElementRenderer({ element, onTap, onHover, onHoverEnd, assetBaseUrl, playing, onAudioRef, onVideoRef }: ElementRendererProps) {
  const { type, x, y, width, height, rotation, opacity, zIndex, props } =
    element;

  const isInteractive = element.interactions.some((i) => i.trigger === "tap");
  const isHoverable = element.interactions.some((i) => i.trigger === "hover" || i.trigger === "hoverEnd");

  const baseStyle: React.CSSProperties = {
    position: "absolute",
    left: 0,
    top: 0,
    width,
    height,
    opacity,
    zIndex,
    transform: `translate(${x}px, ${y}px) rotate(${rotation}deg)`,
    transformOrigin: "center center",
    cursor: isInteractive ? "pointer" : "default",
    userSelect: "none",
  };

  const handleClick = isInteractive ? () => onTap?.(element) : undefined;

  const handleMouseEnter = onHover && isHoverable
    ? (e: React.MouseEvent) => {
        e.stopPropagation();
        if (element.interactions.some((i) => i.trigger === "hover")) {
          onHover(element);
        }
      }
    : undefined;

  const handleMouseLeave = onHoverEnd && isHoverable
    ? (e: React.MouseEvent) => {
        e.stopPropagation();
        if (element.interactions.some((i) => i.trigger === "hoverEnd")) {
          onHoverEnd(element);
        }
      }
    : undefined;

  const children = element.children?.map((child) => (
    <ElementRenderer
      key={child.id}
      element={child}
      onTap={onTap}
      onHover={onHover}
      onHoverEnd={onHoverEnd}
      assetBaseUrl={assetBaseUrl}
      playing={playing}
      onAudioRef={onAudioRef}
      onVideoRef={onVideoRef}
    />
  ));

  switch (type) {
    case "rectangle":
      return (
        <div
          style={{
            ...baseStyle,
            backgroundColor: str(props.fill, "#3b82f6"),
            borderRadius: num(props.radius, 0),
            border: str(props.border, "none"),
          }}
          onClick={handleClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {children}
        </div>
      );

    case "text":
      return (
        <TextElement
          props={props}
          baseStyle={baseStyle}
          width={width}
          height={height}
          onClick={handleClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {children}
        </TextElement>
      );

    case "image":
      return (
        <img
          src={resolveSrc(str(props.src, ""), assetBaseUrl)}
          alt={str(props.alt, "")}
          draggable={false}
          style={{
            ...baseStyle,
            objectFit: str(props.fit, "cover") as React.CSSProperties["objectFit"],
          }}
          onClick={handleClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onError={(e) => {
            // If bundled placeholder fails to load, fall back to embedded SVG
            const target = e.currentTarget;
            if (target.src.startsWith("app://placeholder")) {
              target.src = PLACEHOLDER_FALLBACK;
              console.warn("Bundled placeholder failed to load, using embedded SVG fallback");
            }
          }}
        />
      );

    case "video":
      return (
        <VideoElement
          element={element}
          assetBaseUrl={assetBaseUrl}
          playing={playing}
          onVideoRef={onVideoRef}
          baseStyle={baseStyle}
        />
      );

    case "audio":
      return (
        <AudioElement
          element={element}
          baseStyle={baseStyle}
          assetBaseUrl={assetBaseUrl}
          playing={playing}
          onTap={() => onTap?.(element)}
          onAudioRef={onAudioRef}
        />
      );

    case "button":
      return (
        <div
          role="button"
          style={{
            ...baseStyle,
            backgroundColor: str(props.fill, "#2563eb"),
            color: str(props.color, "#ffffff"),
            borderRadius: num(props.radius, 12),
            fontSize: num(props.fontSize, 28),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
          onClick={() => onTap?.(element)}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {str(props.label, "Button")}
          {children}
        </div>
      );

    case "group":
      return (
        <div
          style={baseStyle}
          onClick={handleClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {children}
        </div>
      );

    case "collection":
      return (
        <div
          style={{ ...baseStyle, overflow: "hidden" }}
          onClick={handleClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <CollectionRenderer
            width={width}
            height={height}
            props={props}
            assetBaseUrl={assetBaseUrl}
            playing={playing}
          />
        </div>
      );

    default:
      return null;
  }
}

// --- audio element with fade-in/out ----------------------------------------

interface AudioElementProps {
  element: Element;
  baseStyle: React.CSSProperties;
  assetBaseUrl?: string;
  playing?: boolean;
  onTap: () => void;
  onAudioRef?: (elementId: string, ref: HTMLAudioElement | null) => void;
}

function AudioElement({ element, baseStyle, assetBaseUrl, playing, onTap, onAudioRef }: AudioElementProps) {
  const audioRef = React.useRef<HTMLAudioElement>(null);
  const fadeTimeoutRef = React.useRef<ReturnType<typeof setTimeout>>();
  const fadeAnimationRef = React.useRef<number>();
  const maxFadeDurationMs = React.useRef(0);
  const currentVolumeRef = React.useRef(1);

  const props = element.props;
  const src = resolveSrc(str(props.src, ""), assetBaseUrl);
  const volume = num(props.volume, 1);
  const fadeMs = Math.max(0, num(props.fade, 0));
  const autoplay = bool(props.autoplay, false);
  const loop = bool(props.loop, false);
  const muted = bool(props.muted, false);

  // Setup fade-in on play
  const handlePlay = () => {
    if (audioRef.current && fadeMs > 0) {
      cancelAnimationFrame(fadeAnimationRef.current ?? 0);
      clearTimeout(fadeTimeoutRef.current);

      // Calculate max fade duration based on audio duration (in milliseconds)
      const durationMs = (audioRef.current.duration || 0) * 1000;
      maxFadeDurationMs.current = Math.min(Math.max(durationMs / 2, 0), 5000);
      const clampedFadeMs = Math.min(fadeMs, maxFadeDurationMs.current);

      // Fade in
      currentVolumeRef.current = 0;
      audioRef.current.volume = 0;
      const startTime = Date.now();

      const fadeInFrame = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / clampedFadeMs, 1);
        if (audioRef.current) {
          currentVolumeRef.current = volume * progress;
          audioRef.current.volume = currentVolumeRef.current;
        }
        if (progress < 1) {
          fadeAnimationRef.current = requestAnimationFrame(fadeInFrame);
        } else {
          // Schedule fade-out
          if (durationMs > 0 && clampedFadeMs > 0) {
            const fadeOutDelayMs = durationMs - clampedFadeMs;
            fadeTimeoutRef.current = setTimeout(() => {
              scheduleFadeOut(clampedFadeMs);
            }, fadeOutDelayMs);
          }
        }
      };
      fadeAnimationRef.current = requestAnimationFrame(fadeInFrame);
    }
  };

  const scheduleFadeOut = (fadeDurationMs: number) => {
    if (!audioRef.current) return;
    cancelAnimationFrame(fadeAnimationRef.current ?? 0);

    const startVolume = audioRef.current.volume;
    const startTime = Date.now();

    const fadeOutFrame = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / fadeDurationMs, 1);
      if (audioRef.current) {
        currentVolumeRef.current = startVolume * (1 - progress);
        audioRef.current.volume = Math.max(currentVolumeRef.current, 0);
      }
      if (progress < 1) {
        fadeAnimationRef.current = requestAnimationFrame(fadeOutFrame);
      }
    };
    fadeAnimationRef.current = requestAnimationFrame(fadeOutFrame);
  };

  const handleCanPlay = () => {
    if (audioRef.current) {
      const durationMs = (audioRef.current.duration || 0) * 1000;
      maxFadeDurationMs.current = Math.min(Math.max(durationMs / 2, 0), 5000);
      const clampedFadeMs = Math.min(fadeMs, maxFadeDurationMs.current);

      // If audio is already playing, schedule fade-out
      if (!audioRef.current.paused && clampedFadeMs > 0 && durationMs > 0) {
        const currentTimeMs = audioRef.current.currentTime * 1000;
        const timeUntilEndMs = durationMs - currentTimeMs;
        const fadeOutStartMs = timeUntilEndMs - clampedFadeMs;

        if (fadeOutStartMs > 0) {
          clearTimeout(fadeTimeoutRef.current);
          fadeTimeoutRef.current = setTimeout(() => {
            scheduleFadeOut(clampedFadeMs);
          }, Math.max(fadeOutStartMs, 0));
        }
      }
    }
  };

  const handleEnded = () => {
    cancelAnimationFrame(fadeAnimationRef.current ?? 0);
    clearTimeout(fadeTimeoutRef.current);
  };

  React.useEffect(() => {
    return () => {
      cancelAnimationFrame(fadeAnimationRef.current ?? 0);
      clearTimeout(fadeTimeoutRef.current);
    };
  }, []);

  // Set initial volume after render
  React.useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
      currentVolumeRef.current = volume;
    }
  }, [volume]);

  React.useEffect(() => {
    onAudioRef?.(element.id, audioRef.current);
    return () => {
      onAudioRef?.(element.id, null);
    };
  }, [element.id, onAudioRef]);

  // Embedded fallback audio icon (speaker with sound waves) - 60x60 SVG as data URI
  const AUDIO_ICON_FALLBACK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolygon points='11 5 6 9 2 9 2 15 6 15 11 19 11 5'%3E%3C/polygon%3E%3Cpath d='M15.54 8.46a5 5 0 0 1 0 7.07'%3E%3C/path%3E%3Cpath d='M19.07 4.93a10 10 0 0 1 0 14.14'%3E%3C/path%3E%3C/svg%3E";

  return (
    <div
      style={{
        ...baseStyle,
        border: "1px solid #64748b",
        borderRadius: 4,
        backgroundColor: "#1e293b",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        overflow: "hidden",
      }}
      onClick={onTap}
    >
      {/* Background icon image */}
      <img
        src="app://audio-icon.png"
        alt="Audio"
        draggable={false}
        onError={(e) => {
          // Fallback to embedded SVG if bundled icon fails to load
          e.currentTarget.src = AUDIO_ICON_FALLBACK;
        }}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          opacity: 0.6,
          pointerEvents: "none",
        }}
      />
      {/* Hidden audio element for playback */}
      <audio
        ref={audioRef}
        src={src}
        autoPlay={autoplay && playing}
        loop={loop}
        muted={muted}
        onPlay={handlePlay}
        onCanPlay={handleCanPlay}
        onEnded={handleEnded}
        onError={() => console.warn(`Failed to load audio: ${src}`)}
        style={{ display: "none" }}
      />
    </div>
  );
}

// --- video element with Video.js -------------------------------------------

interface VideoElementProps {
  element: Element;
  assetBaseUrl?: string;
  playing?: boolean;
  onVideoRef?: (elementId: string, ref: HTMLVideoElement | null) => void;
  baseStyle: React.CSSProperties;
}

/**
 * Video.js-powered video element with advanced controls.
 * Supports standard video formats (mp4, webm) and adaptive streaming (HLS m3u8).
 */
function VideoElement({ element, assetBaseUrl, playing, onVideoRef, baseStyle }: VideoElementProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<ReturnType<typeof videojs> | null>(null);
  const { props } = element;

  const src = resolveSrc(str(props.src, ""), assetBaseUrl);

  useEffect(() => {
    const rawSrc = str(props.src, "");
    //Is DOM Cache Cleared?
    console.log(`[VideoElement ${element.id}] Init effect triggered`, {
      hasVideoRef: !!videoRef.current,
      isInDOM: videoRef.current ? document.contains(videoRef.current) : false,
      src,
      assetBaseUrl,
      rawSrc,
      playing,
    });

    if (!videoRef.current) {
      console.warn(`[VideoElement ${element.id}] No video ref, skipping init`);
      return;
    }


    console.log(`[VideoElement ${element.id}] Initializing Video.js player`, {
      src,
      detectedType: detectVideoType(src),
      controls: bool(props.controls, true),
      autoplay: bool(props.autoplay, true) && playing,
      muted: bool(props.muted, true),
    });

    // Test 1.2: Check video element state before init
    console.log('Video element state before init:', {
      src: videoRef.current.src,
      error: videoRef.current.error,
      networkState: videoRef.current.networkState,
      readyState: videoRef.current.readyState,
      classList: Array.from(videoRef.current.classList),
    });

    // Check if Video.js already initialized this element (React Strict Mode double-invoke)
    let player = videoRef.current && (videoRef.current as any).player;

    if (player && !player.isDisposed()) {
      console.log(`[VideoElement ${element.id}] Reusing existing Video.js player`);
      playerRef.current = player;
    } else {
      // Clean up any stale Video.js data attributes
      if (videoRef.current) {
        videoRef.current.removeAttribute('data-vjs-player');
        const vjsId = videoRef.current.id;
        if (vjsId && vjsId.startsWith('vjs_video_')) {
          videoRef.current.id = '';
        }
      }

      // Reset video element state before Video.js init to clear any cached codec/error state
      videoRef.current.src = '';
      videoRef.current.removeAttribute('src');
      const sourceElements = videoRef.current.querySelectorAll('source');
      sourceElements.forEach(s => s.remove());
      videoRef.current.load();
      console.log('Video element reset before Video.js init');

      // Initialize Video.js player
      player = videojs(videoRef.current, {
        controls: bool(props.controls, true),
        autoplay: bool(props.autoplay, true) && playing,
        loop: bool(props.loop, true),
        muted: bool(props.muted, true),
        preload: str(props.preload, "auto") as "auto" | "metadata" | "none",
        responsive: bool(props.responsive, true),
        fluid: bool(props.fluid, false),
        playbackRates: [0.5, 1, 1.5, 2],
      });

      console.log(`[VideoElement ${element.id}] Video.js player created successfully`);

      // Set initial volume and speed
      player.volume(num(props.volume, 1));
      player.playbackRate(num(props.playbackRate, 1));

      // Store player reference on the video element for programmatic control
      playerRef.current = player;
      (videoRef.current as any).player = player;
    }

    // Register video element ref with Player
    onVideoRef?.(element.id, videoRef.current);
    console.log(`[VideoElement ${element.id}] Registered with Player context`);

    // Cleanup: unregister from Player context
    // NOTE: We intentionally don't dispose the player here to handle React Strict Mode
    // double-invoke in dev. The init code above checks for existing players and reuses them.
    return () => {
      console.log(`[VideoElement ${element.id}] Cleanup: unregistering`);
      onVideoRef?.(element.id, null);
    };
  }, [element.id, playing, onVideoRef]);

  // Sync props with player when they change
  useEffect(() => {
    if (!playerRef.current) return;

    console.log(`[VideoElement ${element.id}] Syncing props`, {
      volume: num(props.volume, 1),
      playbackRate: num(props.playbackRate, 1),
      muted: bool(props.muted, true),
      loop: bool(props.loop, true),
    });

    playerRef.current.volume(num(props.volume, 1));
    playerRef.current.playbackRate(num(props.playbackRate, 1));
    playerRef.current.muted(bool(props.muted, true));
    playerRef.current.loop(bool(props.loop, true));
  }, [props.volume, props.playbackRate, props.muted, props.loop]);

  // Update source when it changes
  useEffect(() => {
    if (!playerRef.current || !src) {
      console.log(`[VideoElement ${element.id}] Source update skipped`, {
        hasPlayer: !!playerRef.current,
        src,
      });
      return;
    }

    console.log(`[VideoElement ${element.id}] Updating source`, {
      src,
      type: detectVideoType(src),
    });

    playerRef.current.src({
      src: src,
      type: detectVideoType(src),
    });
  }, [src]);

  const rawSrc = str(props.src, "");
  const hasSource = rawSrc && rawSrc.trim() !== "";

  return (
    <div
      data-vjs-player
      style={baseStyle}
    >
      <video
        ref={videoRef}
        className="video-js vjs-big-play-centered"
        playsInline
        style={{
          width: "100%",
          height: "100%",
          objectFit: str(props.fit, "cover") as React.CSSProperties["objectFit"],
        }}
      />
      {!hasSource && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#1e293b",
            color: "#64748b",
            fontSize: 24,
            fontFamily: "system-ui, sans-serif",
            pointerEvents: "none",
          }}
        >
          🎬 No video source
        </div>
      )}
    </div>
  );
}

/**
 * Detect MIME type from file extension.
 * Supports: mp4, webm, ogg, m3u8 (HLS), mpd (DASH).
 */
function detectVideoType(src: string): string {
  const ext = src.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'mp4':
      return 'video/mp4';
    case 'webm':
      return 'video/webm';
    case 'ogg':
      return 'video/ogg';
    case 'm3u8':
      return 'application/x-mpegURL';
    case 'mpd':
      return 'application/dash+xml';
    default:
      return 'video/mp4';
  }
}

// --- text element (per-line rich text + autofit) ----------------------------

interface TextRun {
  text: string;
  fontSize?: number;
  color?: string;
  fontWeight?: string;
  fontStyle?: string;
  align?: "left" | "center" | "right";
}

const LINE_HEIGHT = 1.15; // tight, close to PowerPoint's default

/**
 * A text box. Supports per-line rich text (`props.runs`: each line carries its
 * own weight/size/color, so a box can have bold top-level bullets and non-bold
 * sub-bullets) with a fallback to the single box-level style. Mirrors
 * PowerPoint's normAutofit by MEASURING the rendered content and shrinking the
 * font uniformly until it fits the box height (PowerPoint computes that shrink
 * live, so the stored fontScale is usually absent and we can't trust it).
 */
function TextElement({
  props,
  baseStyle,
  width,
  height,
  onClick,
  onMouseEnter,
  onMouseLeave,
  children,
}: {
  props: Record<string, unknown>;
  baseStyle: React.CSSProperties;
  width: number;
  height: number;
  onClick?: () => void;
  onMouseEnter?: (e: React.MouseEvent) => void;
  onMouseLeave?: (e: React.MouseEvent) => void;
  children?: React.ReactNode;
}) {
  const align = str(props.align, "left") as "left" | "center" | "right";
  const justify = align === "right" ? "flex-end" : align === "center" ? "center" : "flex-start";
  const baseColor = str(props.color, "#ffffff");
  const baseFontSize = num(props.fontSize, 32);
  const baseWeight = str(props.fontWeight, "normal");
  const baseFontStyle = str(props.fontStyle, "normal");
  const runs = parseRuns(props.runs);

  const innerRef = React.useRef<HTMLDivElement>(null);
  const [fit, setFit] = React.useState(1);

  // After layout, measure the content vs the box and shrink to fit. Re-run when
  // anything affecting layout changes. Reset to 1 first so growth (e.g. box
  // resized larger in the editor) is re-measured from full size.
  React.useLayoutEffect(() => {
    setFit(1);
  }, [width, height, baseFontSize, props.text, props.runs]);

  React.useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el || height <= 0) return;
    // scrollHeight is the unclipped content height at the current fit.
    const content = el.scrollHeight;
    const budget = height * 0.98; // small bottom margin so descenders survive
    if (content > budget && fit > 0.4) {
      const next = Math.max(0.4, fit * (budget / content));
      // Avoid thrashing on sub-pixel differences.
      if (next < fit - 0.005) setFit(next);
    }
  });

  const lines = runs ?? [{ text: str(props.text, "") }];

  return (
    <div
      style={{
        ...baseStyle,
        color: baseColor,
        fontWeight: baseWeight,
        fontStyle: baseFontStyle,
        fontFamily: str(props.fontFamily, "system-ui, sans-serif"),
        // Column flex: alignItems honors horizontal alignment; top-anchored
        // (flex-start) to match PowerPoint's default text-box anchoring and
        // keep multi-line bodies reading from the top.
        display: "flex",
        flexDirection: "column",
        alignItems: justify,
        justifyContent: "flex-start",
        textAlign: align as React.CSSProperties["textAlign"],
        whiteSpace: "pre-wrap",
        overflow: "hidden",
      }}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div ref={innerRef} style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: justify }}>
        {lines.map((r, i) => {
          const blank = !r.text.trim();
          return (
            <div
              key={i}
              style={{
                width: "100%",
                color: r.color ?? baseColor,
                fontSize: (r.fontSize ?? baseFontSize) * fit,
                // Blank paragraphs are spacing — render at half height so a run
                // of them doesn't push content off the box.
                lineHeight: blank ? 0.5 : LINE_HEIGHT,
                fontWeight: r.fontWeight ?? baseWeight,
                fontStyle: r.fontStyle ?? baseFontStyle,
                textAlign: (r.align ?? align) as React.CSSProperties["textAlign"],
              }}
            >
              {r.text || " "}
            </div>
          );
        })}
      </div>
      {children}
    </div>
  );
}

/** Coerce an untyped `props.runs` into a clean TextRun[], or null if absent. */
function parseRuns(v: unknown): TextRun[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  return v.map((raw) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    const run: TextRun = { text: typeof o.text === "string" ? o.text : "" };
    if (typeof o.fontSize === "number") run.fontSize = o.fontSize;
    if (typeof o.color === "string") run.color = o.color;
    if (typeof o.fontWeight === "string") run.fontWeight = o.fontWeight;
    if (typeof o.fontStyle === "string") run.fontStyle = o.fontStyle;
    if (o.align === "left" || o.align === "center" || o.align === "right") run.align = o.align;
    return run;
  });
}

// --- small prop coercion helpers (props are Record<string, unknown>) -------

function str(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}
function num(v: unknown, fallback: number): number {
  return typeof v === "number" ? v : fallback;
}
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}
