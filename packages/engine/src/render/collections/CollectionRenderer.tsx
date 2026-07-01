import React, { useEffect, useRef, useState } from "react";
import { resolveSrc } from "../ElementRenderer.js";

/**
 * Renders a "collection" element: a set of templated items laid out in a chosen
 * style (grid / carousel / coverflow / kenburns). Slice 1 uses a fixed item
 * template (image + title + subtitle) and a static item list from props.items.
 *
 * `playing` gates time-based behavior (Ken Burns auto-advance) so collections
 * sit still while authoring in the editor and animate in the Player.
 */

/**
 * Determines if a source path is a video based on file extension.
 */
function isVideo(src: string): boolean {
  const ext = src.split('.').pop()?.toLowerCase();
  return ext === 'mp4' || ext === 'webm' || ext === 'mov' || ext === 'ogg';
}

export interface CollectionItem {
  id: string;
  title?: string;
  subtitle?: string;
  image?: string;
  thumbnail?: string;
}

export interface CollectionRendererProps {
  width: number;
  height: number;
  props: Record<string, unknown>;
  assetBaseUrl?: string;
  playing?: boolean;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function num(v: unknown, fallback: number): number {
  return typeof v === "number" ? v : fallback;
}
function items(v: unknown): CollectionItem[] {
  return Array.isArray(v) ? (v as CollectionItem[]) : [];
}

export function CollectionRenderer({
  width,
  height,
  props,
  assetBaseUrl,
  playing = false,
}: CollectionRendererProps) {
  const layout = str(props.layout, "grid");
  const list = items(props.items);
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const [activeIndex, setActiveIndex] = useState<number | null>(layout === "grid" ? null : 0);

  const videoMuted = props.videoMuted !== false; // default true
  const videoLoop = props.videoLoop !== false; // default true
  const advanceOnVideoEnd = props.advanceOnVideoEnd === true; // default false
  const advanceDelayMs = num(props.advanceDelayMs, 0);

  // Video orchestration: play active video, pause+reset all others
  useEffect(() => {
    const videos = videoRefs.current;
    if (videos.size === 0 || !playing) return;

    list.forEach((item, idx) => {
      const video = videos.get(item.id);
      if (!video) return;

      const isActive = idx === activeIndex;

      if (isActive) {
        // Active video: unmute (if videoMuted: false), reset to start, play
        video.muted = videoMuted;
        video.loop = videoLoop;
        video.currentTime = 0;
        video.play().catch(() => {/* ignore autoplay failures */});
      } else {
        // Inactive videos: pause, reset, mute
        video.pause();
        video.currentTime = 0;
        video.muted = true;
      }
    });
  }, [activeIndex, playing, list, videoMuted, videoLoop]);

  // Auto-advance on video end (for all layouts when enabled)
  useEffect(() => {
    if (!playing || !advanceOnVideoEnd || activeIndex === null || list.length <= 1) return;

    const currentItem = list[activeIndex];
    if (!currentItem) return;

    const video = videoRefs.current.get(currentItem.id);
    if (!video) return;

    const onEnded = () => {
      setTimeout(() => {
        setActiveIndex((activeIndex + 1) % list.length);
      }, advanceDelayMs);
    };

    video.addEventListener("ended", onEnded);
    return () => video.removeEventListener("ended", onEnded);
  }, [playing, advanceOnVideoEnd, advanceDelayMs, activeIndex, list, videoRefs, setActiveIndex]);

  // Cleanup on unmount: pause and reset all videos
  useEffect(() => {
    return () => {
      videoRefs.current.forEach((video) => {
        video.pause();
        video.currentTime = 0;
      });
    };
  }, []);

  const common = { list, props, assetBaseUrl, width, height, videoRefs, activeIndex, setActiveIndex };

  switch (layout) {
    case "carousel":
      return <Carousel {...common} playing={playing} />;
    case "coverflow":
      return <Coverflow {...common} playing={playing} />;
    case "wheel":
      return <Wheel {...common} playing={playing} />;
    case "kenburns":
      return <KenBurns {...common} playing={playing} />;
    case "grid":
    default:
      return <Grid {...common} playing={playing} />;
  }
}

/**
 * Pointer/touch drag-to-scroll for index-based layouts. Returns the live drag
 * delta (in index units, e.g. 0.4 = dragged 40% toward the next card) and a
 * pointer-down handler. On release, advances if the drag passed a threshold,
 * else snaps back. Only active when `enabled` (Player mode) — in the editor,
 * dragging the element should move it, not scroll the carousel.
 *
 * @param axis "x" for horizontal swipe (carousel/coverflow), "y" for vertical (wheel)
 */
function useSwipe(
  enabled: boolean,
  cardPx: number,
  onCommit: (deltaIndex: number) => void,
  axis: "x" | "y" = "x"
): { dragIndex: number; onPointerDown: (e: React.PointerEvent) => void } {
  const [dragIndex, setDragIndex] = useState(0);
  const start = React.useRef<number | null>(null);

  function onPointerDown(e: React.PointerEvent) {
    if (!enabled || cardPx <= 0) return;
    e.stopPropagation();
    start.current = axis === "x" ? e.clientX : e.clientY;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);

    const move = (ev: PointerEvent) => {
      if (start.current == null) return;
      const coord = axis === "x" ? ev.clientX : ev.clientY;
      setDragIndex(-(coord - start.current) / cardPx);
    };
    const up = (ev: PointerEvent) => {
      const coord = axis === "x" ? ev.clientX : ev.clientY;
      const d = start.current == null ? 0 : -(coord - start.current) / cardPx;
      start.current = null;
      setDragIndex(0);
      // Commit a step if dragged more than 30% of a card, in the drag direction.
      if (d > 0.3) onCommit(1);
      else if (d < -0.3) onCommit(-1);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return { dragIndex, onPointerDown };
}

// --- shared item card ------------------------------------------------------

function ItemCard({
  item,
  props,
  assetBaseUrl,
  style,
  videoRef,
  isActive,
  objectFit = "cover",
}: {
  item: CollectionItem;
  props: Record<string, unknown>;
  assetBaseUrl?: string;
  style?: React.CSSProperties;
  videoRef?: (el: HTMLVideoElement | null) => void;
  isActive?: boolean;
  objectFit?: "cover" | "contain";
}) {
  const src = resolveSrc(str(item.image), assetBaseUrl);
  const hasVideo = src && isVideo(src);

  // Switch preload based on active state
  useEffect(() => {
    if (!hasVideo) return;
    // Effect runs after render, so videoRef callback has already run
  }, [isActive, hasVideo]);

  return (
    <div
      style={{
        background: str(props.itemBg, "#1e293b"),
        borderRadius: 10,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        ...style,
      }}
    >
      <div style={{ flex: 1, minHeight: 0, background: "#0b1016" }}>
        {src ? (
          hasVideo ? (
            <video
              ref={videoRef}
              src={src}
              preload={isActive ? "auto" : "metadata"}
              style={{ width: "100%", height: "100%", objectFit, display: "block" }}
            />
          ) : (
            <img src={src} alt={str(item.title)} style={{ width: "100%", height: "100%", objectFit, display: "block" }} draggable={false} />
          )
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#475569", fontSize: 14 }}>
            no media
          </div>
        )}
      </div>
      {(item.title || item.subtitle) && (
        <div style={{ padding: "10px 12px" }}>
          {item.title && (
            <div style={{ color: str(props.titleColor, "#f8fafc"), fontSize: 22, fontWeight: 600 }}>{item.title}</div>
          )}
          {item.subtitle && (
            <div style={{ color: str(props.subtitleColor, "#94a3b8"), fontSize: 16 }}>{item.subtitle}</div>
          )}
        </div>
      )}
    </div>
  );
}

interface LayoutProps {
  list: CollectionItem[];
  props: Record<string, unknown>;
  assetBaseUrl?: string;
  width: number;
  height: number;
  videoRefs: React.MutableRefObject<Map<string, HTMLVideoElement>>;
  activeIndex: number | null;
  setActiveIndex: (idx: number | null) => void;
}

// --- grid ------------------------------------------------------------------

function Grid({ list, props, assetBaseUrl, videoRefs, activeIndex, setActiveIndex, playing }: LayoutProps & { playing?: boolean }) {
  const columns = Math.max(1, num(props.columns, 3));
  const gap = num(props.gap, 16);
  const focusedIndex = activeIndex;
  const isFocused = focusedIndex !== null;

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
      {/* Browsing grid */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          overflowY: "auto",
          display: "grid",
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
          gap,
          gridAutoRows: "minmax(160px, auto)",
          boxSizing: "border-box",
          opacity: isFocused ? 0 : 1,
          pointerEvents: isFocused ? "none" : "auto",
          transition: "opacity 300ms ease",
        }}
      >
        {list.map((it, idx) => (
          <div key={it.id} onClick={() => playing && setActiveIndex(idx)} style={{ cursor: playing ? "pointer" : undefined }}>
            <ItemCard
              item={{ ...it, image: it.thumbnail || it.image }} // Use thumbnail for grid view
              props={props}
              assetBaseUrl={assetBaseUrl}
              videoRef={(el) => el && videoRefs.current.set(it.id, el)}
              isActive={idx === activeIndex}
            />
          </div>
        ))}
      </div>

      {/* Focused overlay */}
      {isFocused && focusedIndex < list.length && (
        <div
          onClick={() => setActiveIndex(null)}
          style={{
            position: "absolute",
            inset: 0,
            background: "#0b1016",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            opacity: 1,
            transition: "opacity 300ms ease",
            zIndex: 10,
          }}
        >
          {(() => {
            const item = list[focusedIndex];
            const src = resolveSrc(str(item.image), assetBaseUrl);
            const hasVideo = src && isVideo(src);
            return (
              <>
                {src ? (
                  hasVideo ? (
                    <video
                      ref={(el) => el && videoRefs.current.set(item.id, el)}
                      src={src}
                      preload="auto"
                      style={{
                        maxWidth: "100%",
                        maxHeight: "100%",
                        objectFit: "contain",
                      }}
                    />
                  ) : (
                    <img
                      src={src}
                      alt={str(item.title)}
                      style={{
                        maxWidth: "100%",
                        maxHeight: "100%",
                        objectFit: "contain",
                      }}
                      draggable={false}
                    />
                  )
                ) : (
                  <div style={{ color: "#475569", fontSize: 14 }}>no media</div>
                )}
                {(item.title || item.subtitle) && (
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      bottom: 0,
                      padding: 24,
                      background: "linear-gradient(transparent, rgba(0,0,0,0.7))",
                    }}
                  >
                    {item.title && (
                      <div style={{ color: str(props.titleColor, "#fff"), fontSize: 32, fontWeight: 700 }}>
                        {item.title}
                      </div>
                    )}
                    {item.subtitle && (
                      <div style={{ color: str(props.subtitleColor, "#cbd5e1"), fontSize: 20 }}>
                        {item.subtitle}
                      </div>
                    )}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// --- carousel --------------------------------------------------------------

function Carousel({ list, props, assetBaseUrl, width, videoRefs, activeIndex, setActiveIndex, playing }: LayoutProps & { playing?: boolean }) {
  const n = list.length || 1;
  const idx = activeIndex !== null ? ((activeIndex % n) + n) % n : 0;
  const cardW = width * 0.6;
  const { dragIndex, onPointerDown } = useSwipe(!!playing, cardW * 1.05, (d) => setActiveIndex(idx + d));
  const dragging = dragIndex !== 0;
  // Live position follows the finger; cards sit one card-width (105%) apart.
  const pos = idx + dragIndex;
  return (
    <div
      onPointerDown={onPointerDown}
      style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", touchAction: "none", cursor: playing ? "grab" : undefined }}
    >
      <div style={{ width: cardW, height: "85%", position: "relative" }}>
        {list.map((it, i) => {
          const offset = i - pos;
          return (
            <div
              key={it.id}
              style={{
                position: "absolute",
                inset: 0,
                transform: `translateX(${offset * 105}%)`,
                transition: dragging ? "none" : "transform 350ms ease, opacity 350ms ease",
                opacity: Math.abs(offset) < 0.5 ? 1 : 0.5,
              }}
            >
              <ItemCard
                item={it}
                props={props}
                assetBaseUrl={assetBaseUrl}
                style={{ width: "100%", height: "100%" }}
                videoRef={(el) => el && videoRefs.current.set(it.id, el)}
                isActive={i === activeIndex}
              />
            </div>
          );
        })}
      </div>
      <NavButton side="left" onClick={() => setActiveIndex(idx - 1)} />
      <NavButton side="right" onClick={() => setActiveIndex(idx + 1)} />
    </div>
  );
}

// --- wheel -----------------------------------------------------------------

function Wheel({ list, props, assetBaseUrl, width, height, videoRefs, activeIndex, setActiveIndex, playing }: LayoutProps & { playing?: boolean }) {
  const n = list.length || 1;
  const idx = activeIndex !== null ? ((activeIndex % n) + n) % n : 0;

  // Size cards to 16:9 aspect (standard video), fit within 60% of container height
  const maxH = height * 0.65;
  const maxW = width * 0.80;
  const aspectW = maxH * (16 / 9);
  const cardW = Math.min(aspectW, maxW);
  const cardH = cardW * (9 / 16);

  const { dragIndex, onPointerDown } = useSwipe(!!playing, cardH * 0.9, (d) => setActiveIndex(idx + d), "y");
  const dragging = dragIndex !== 0;
  const pos = idx + dragIndex;
  return (
    <div
      onPointerDown={onPointerDown}
      style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", perspective: 1200, touchAction: "none", cursor: playing ? "grab" : undefined }}
    >
      <div style={{ width: cardW, height: cardH, position: "relative", transformStyle: "preserve-3d" }}>
        {list.map((it, i) => {
          const offset = i - pos;
          const abs = Math.abs(offset);
          const rot = Math.max(-35, Math.min(35, -offset * 35));
          const depth = abs < 0.5 ? 200 : 0;
          return (
            <div
              key={it.id}
              onClick={() => playing && !dragging && setActiveIndex(i)}
              style={{
                position: "absolute",
                inset: 0,
                transform: `translateY(${offset * 90}%) translateZ(${depth}px) rotateX(${rot}deg) scale(${abs < 0.5 ? 1 : 0.85})`,
                transition: dragging ? "none" : "transform 350ms ease, opacity 350ms ease",
                opacity: abs > 1.5 ? 0 : 1,
                cursor: playing ? "pointer" : undefined,
              }}
            >
              <ItemCard
                item={it}
                props={props}
                assetBaseUrl={assetBaseUrl}
                style={{ width: "100%", height: "100%" }}
                videoRef={(el) => el && videoRefs.current.set(it.id, el)}
                isActive={i === activeIndex}
                objectFit="contain"
              />
            </div>
          );
        })}
      </div>
      <NavButton side="up" onClick={() => setActiveIndex(idx - 1)} />
      <NavButton side="down" onClick={() => setActiveIndex(idx + 1)} />
    </div>
  );
}

// --- coverflow -------------------------------------------------------------

function Coverflow({ list, props, assetBaseUrl, width, videoRefs, activeIndex, setActiveIndex, playing }: LayoutProps & { playing?: boolean }) {
  const n = list.length || 1;
  const idx = activeIndex !== null ? ((activeIndex % n) + n) % n : 0;
  const cardW = width * 0.6;
  const { dragIndex, onPointerDown } = useSwipe(!!playing, cardW, (d) => setActiveIndex(idx + d));
  const dragging = dragIndex !== 0;
  const pos = idx + dragIndex;
  return (
    <div
      onPointerDown={onPointerDown}
      style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", perspective: 1200, touchAction: "none", cursor: playing ? "grab" : undefined }}
    >
      <div style={{ width: cardW, height: "80%", position: "relative", transformStyle: "preserve-3d" }}>
        {list.map((it, i) => {
          const offset = i - pos;
          const abs = Math.abs(offset);
          const rot = Math.max(-45, Math.min(45, -offset * 45));
          return (
            <div
              key={it.id}
              onClick={() => playing && !dragging && setActiveIndex(i)}
              style={{
                position: "absolute",
                inset: 0,
                transform: `translateX(${offset * 55}%) rotateY(${rot}deg) scale(${abs < 0.5 ? 1 : 0.8})`,
                transition: dragging ? "none" : "transform 350ms ease, opacity 350ms ease",
                opacity: abs > 2 ? 0 : 1,
                zIndex: 100 - Math.round(abs),
                cursor: playing ? "pointer" : undefined,
              }}
            >
              <ItemCard
                item={it}
                props={props}
                assetBaseUrl={assetBaseUrl}
                style={{ width: "100%", height: "100%" }}
                videoRef={(el) => el && videoRefs.current.set(it.id, el)}
                isActive={i === activeIndex}
              />
            </div>
          );
        })}
      </div>
      <NavButton side="left" onClick={() => setActiveIndex(idx - 1)} />
      <NavButton side="right" onClick={() => setActiveIndex(idx + 1)} />
    </div>
  );
}

// --- ken burns -------------------------------------------------------------

function KenBurns({ list, props, assetBaseUrl, videoRefs, activeIndex, setActiveIndex, playing }: LayoutProps & { playing?: boolean }) {
  const n = list.length || 1;
  const idx = activeIndex !== null ? ((activeIndex % n) + n) % n : 0;
  const interval = Math.max(1000, num(props.intervalMs, 4000));

  // Auto-advance timer for image items
  useEffect(() => {
    if (!playing || n <= 1) return;
    const currentItem = list[idx];
    const src = resolveSrc(str(currentItem?.image), assetBaseUrl);
    const hasVideo = src && isVideo(src);

    // Only use timer for image items (videos use ended event via parent component)
    if (hasVideo) return;

    const t = setInterval(() => setActiveIndex((idx + 1) % n), interval);
    return () => clearInterval(t);
  }, [playing, n, interval, idx, list, assetBaseUrl, setActiveIndex]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", background: "#0b1016" }}>
      {list.map((it, i) => {
        const src = resolveSrc(str(it.image), assetBaseUrl);
        const hasVideo = src && isVideo(src);
        const isCur = i === idx;
        return (
          <div
            key={it.id}
            style={{
              position: "absolute",
              inset: 0,
              opacity: isCur ? 1 : 0,
              transition: "opacity 800ms ease",
            }}
          >
            {src && (
              hasVideo ? (
                <video
                  ref={(el) => el && videoRefs.current.set(it.id, el)}
                  src={src}
                  preload={isCur ? "auto" : "metadata"}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    transform: isCur && playing ? "scale(1.12)" : "scale(1)",
                    transition: `transform ${interval}ms linear`,
                  }}
                />
              ) : (
                <img
                  src={src}
                  alt={str(it.title)}
                  draggable={false}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    transform: isCur && playing ? "scale(1.12)" : "scale(1)",
                    transition: `transform ${interval}ms linear`,
                  }}
                />
              )
            )}
            {(it.title || it.subtitle) && (
              <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: 24, background: "linear-gradient(transparent, rgba(0,0,0,0.7))" }}>
                {it.title && (
                  <div style={{ color: str(props.titleColor, "#fff"), fontSize: 32, fontWeight: 700 }}>
                    {it.title}
                  </div>
                )}
                {it.subtitle && (
                  <div style={{ color: str(props.subtitleColor, "#cbd5e1"), fontSize: 20 }}>
                    {it.subtitle}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// --- nav button ------------------------------------------------------------

function NavButton({ side, onClick }: { side: "left" | "right" | "up" | "down"; onClick: () => void }) {
  const isVertical = side === "up" || side === "down";
  const cssProp = side === "up" ? "top" : side === "down" ? "bottom" : side;
  const offset = isVertical ? "15%" : 8;
  const positionStyle = isVertical
    ? { [cssProp]: offset, left: "50%", transform: "translateX(-50%)" }
    : { [cssProp]: offset, top: "50%", transform: "translateY(-50%)" };
  const arrow = side === "left" ? "‹" : side === "right" ? "›" : "‹";
  const rotation = side === "up" ? 90 : side === "down" ? -90 : 0;

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{
        position: "absolute",
        ...positionStyle,
        width: 44,
        height: 44,
        borderRadius: "50%",
        background: "rgba(15,23,42,0.7)",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 22,
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      <span style={{ transform: `rotate(${rotation}deg)`, display: "inline-block" }}>{arrow}</span>
    </div>
  );
}
