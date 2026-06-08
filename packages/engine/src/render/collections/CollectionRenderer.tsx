import React, { useEffect, useState } from "react";
import { resolveSrc } from "../ElementRenderer.js";

/**
 * Renders a "collection" element: a set of templated items laid out in a chosen
 * style (grid / carousel / coverflow / kenburns). Slice 1 uses a fixed item
 * template (image + title + subtitle) and a static item list from props.items.
 *
 * `playing` gates time-based behavior (Ken Burns auto-advance) so collections
 * sit still while authoring in the editor and animate in the Player.
 */

export interface CollectionItem {
  id: string;
  title?: string;
  subtitle?: string;
  image?: string;
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
  const common = { list, props, assetBaseUrl, width, height };

  switch (layout) {
    case "carousel":
      return <Carousel {...common} playing={playing} />;
    case "coverflow":
      return <Coverflow {...common} playing={playing} />;
    case "kenburns":
      return <KenBurns {...common} playing={playing} />;
    case "grid":
    default:
      return <Grid {...common} />;
  }
}

/**
 * Pointer/touch drag-to-scroll for index-based layouts. Returns the live drag
 * delta (in index units, e.g. 0.4 = dragged 40% toward the next card) and a
 * pointer-down handler. On release, advances if the drag passed a threshold,
 * else snaps back. Only active when `enabled` (Player mode) — in the editor,
 * dragging the element should move it, not scroll the carousel.
 */
function useSwipe(
  enabled: boolean,
  cardPx: number,
  onCommit: (deltaIndex: number) => void
): { dragIndex: number; onPointerDown: (e: React.PointerEvent) => void } {
  const [dragIndex, setDragIndex] = useState(0);
  const start = React.useRef<number | null>(null);

  function onPointerDown(e: React.PointerEvent) {
    if (!enabled || cardPx <= 0) return;
    e.stopPropagation();
    start.current = e.clientX;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);

    const move = (ev: PointerEvent) => {
      if (start.current == null) return;
      setDragIndex(-(ev.clientX - start.current) / cardPx);
    };
    const up = (ev: PointerEvent) => {
      const d = start.current == null ? 0 : -(ev.clientX - start.current) / cardPx;
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
}: {
  item: CollectionItem;
  props: Record<string, unknown>;
  assetBaseUrl?: string;
  style?: React.CSSProperties;
}) {
  const src = resolveSrc(str(item.image), assetBaseUrl);
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
          <img src={src} alt={str(item.title)} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} draggable={false} />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#475569", fontSize: 14 }}>
            no image
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
}

// --- grid ------------------------------------------------------------------

function Grid({ list, props, assetBaseUrl }: LayoutProps) {
  const columns = Math.max(1, num(props.columns, 3));
  const gap = num(props.gap, 16);
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        overflowY: "auto",
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gap,
        gridAutoRows: "minmax(160px, auto)",
        boxSizing: "border-box",
      }}
    >
      {list.map((it) => (
        <ItemCard key={it.id} item={it} props={props} assetBaseUrl={assetBaseUrl} />
      ))}
    </div>
  );
}

// --- carousel --------------------------------------------------------------

function Carousel({ list, props, assetBaseUrl, width, playing }: LayoutProps & { playing?: boolean }) {
  const [active, setActive] = useState(num(props.activeIndex, 0));
  const n = list.length || 1;
  const idx = ((active % n) + n) % n;
  const cardW = width * 0.6;
  const { dragIndex, onPointerDown } = useSwipe(!!playing, cardW * 1.05, (d) => setActive(idx + d));
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
              <ItemCard item={it} props={props} assetBaseUrl={assetBaseUrl} style={{ width: "100%", height: "100%" }} />
            </div>
          );
        })}
      </div>
      <NavButton side="left" onClick={() => setActive(idx - 1)} />
      <NavButton side="right" onClick={() => setActive(idx + 1)} />
    </div>
  );
}

// --- coverflow -------------------------------------------------------------

function Coverflow({ list, props, assetBaseUrl, width, playing }: LayoutProps & { playing?: boolean }) {
  const [active, setActive] = useState(num(props.activeIndex, 0));
  const n = list.length || 1;
  const idx = ((active % n) + n) % n;
  const cardW = width * 0.4;
  const { dragIndex, onPointerDown } = useSwipe(!!playing, cardW, (d) => setActive(idx + d));
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
              onClick={() => playing && !dragging && setActive(i)}
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
              <ItemCard item={it} props={props} assetBaseUrl={assetBaseUrl} style={{ width: "100%", height: "100%" }} />
            </div>
          );
        })}
      </div>
      <NavButton side="left" onClick={() => setActive(idx - 1)} />
      <NavButton side="right" onClick={() => setActive(idx + 1)} />
    </div>
  );
}

// --- ken burns -------------------------------------------------------------

function KenBurns({ list, props, assetBaseUrl, playing }: LayoutProps & { playing?: boolean }) {
  const [idx, setIdx] = useState(0);
  const n = list.length || 1;
  const interval = Math.max(1000, num(props.intervalMs, 4000));

  useEffect(() => {
    if (!playing || n <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % n), interval);
    return () => clearInterval(t);
  }, [playing, n, interval]);

  const cur = ((idx % n) + n) % n;
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", background: "#0b1016" }}>
      {list.map((it, i) => {
        const src = resolveSrc(str(it.image), assetBaseUrl);
        const isCur = i === cur;
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
            )}
            {(it.title || it.subtitle) && (
              <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: 24, background: "linear-gradient(transparent, rgba(0,0,0,0.7))" }}>
                {it.title && <div style={{ color: "#fff", fontSize: 32, fontWeight: 700 }}>{it.title}</div>}
                {it.subtitle && <div style={{ color: "#cbd5e1", fontSize: 20 }}>{it.subtitle}</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// --- nav button ------------------------------------------------------------

function NavButton({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{
        position: "absolute",
        [side]: 8,
        top: "50%",
        transform: "translateY(-50%)",
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
      {side === "left" ? "‹" : "›"}
    </div>
  );
}
