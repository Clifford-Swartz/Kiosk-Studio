import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Element, Project, Scene } from "../model/types.js";
import { ElementRenderer, resolveSrc } from "./ElementRenderer.js";
import { runInteraction, type PlayerContext } from "../runtime/interactions.js";
import { bindingContext, bindingHost } from "../data/BindingContext.js";
import { overrideStore } from "../runtime/overrideStore.js";
import { applyOverrides } from "../runtime/applyOverrides.js";
import { useOverrides } from "../runtime/useOverrides.js";

export interface PlayerProps {
  project: Project;
  /** Override the starting scene (defaults to project.startSceneId or first). */
  initialSceneId?: string;
  /** Base URL for resolving relative asset paths (see ElementRenderer). */
  assetBaseUrl?: string;
  /** Apply live data bindings (default true). */
  live?: boolean;
}

/**
 * The Player renders a Project and runs its interactions. It owns the
 * "which scene is active" state and scales the fixed scene resolution to fit
 * the available space (letterboxed), the way a kiosk authored at 1920x1080
 * should display on any screen.
 */
export function Player({ project, initialSceneId, assetBaseUrl, live = true }: PlayerProps) {
  console.log('New player element created.')
  const firstSceneId =
    initialSceneId ?? project.startSceneId ?? project.scenes[0]?.id;
  const [activeSceneId, setActiveSceneId] = useState(firstSceneId);

  // Sync initialSceneId prop changes to internal state (for Canvas scene switching)
  useEffect(() => {
    if (initialSceneId && initialSceneId !== activeSceneId) {
      setActiveSceneId(initialSceneId);
    }
  }, [initialSceneId, activeSceneId]);

  const scene: Scene | undefined = useMemo(
    () => project.scenes.find((s) => s.id === activeSceneId) ?? project.scenes[0],
    [project, activeSceneId]
  );

  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const videoElementsRef = useRef<Map<string, HTMLVideoElement>>(new Map());

  const ctx: PlayerContext = useMemo(
    () => ({
      goToScene: (sceneId) => setActiveSceneId(sceneId),
      setProp: (elementId, key, value) => overrideStore.setOverride(elementId, key, value),
      toggleVisibility: (elementId) => overrideStore.toggle(elementId, "__hidden"),
      playAudio: (elementId) => {
        const audio = audioElementsRef.current.get(elementId);
        if (audio) {
          audio.currentTime = 0;
          audio.play().catch(() => {
            // Autoplay may be blocked by browser; fail silently
          });
        }
      },
      togglePlayVideo: (elementId) => {
        console.log(`[Player] togglePlayVideo called for element: ${elementId}`);
        const video = videoElementsRef.current.get(elementId);

        if (!video) {
          console.warn(`[Player] togglePlayVideo: video element ${elementId} not found in registry`);
          console.log(`[Player] Available video elements:`, Array.from(videoElementsRef.current.keys()));
          return;
        }

        if (!(video as any).player) {
          console.warn(`[Player] togglePlayVideo: video element ${elementId} has no player attached`);
          return;
        }

        const player = (video as any).player;
        const isPaused = player.paused();
        console.log(`[Player] togglePlayVideo: element ${elementId} is currently ${isPaused ? 'paused' : 'playing'}`);

        if (isPaused) {
          console.log(`[Player] togglePlayVideo: calling play() on ${elementId}`);
          player.play();
        } else {
          console.log(`[Player] togglePlayVideo: calling pause() on ${elementId}`);
          player.pause();
        }
      },
      seekVideo: (elementId, time) => {
        console.log(`[Player] seekVideo called for element: ${elementId}, time: ${time}`);
        const video = videoElementsRef.current.get(elementId);
        if (video && (video as any).player) {
          (video as any).player.currentTime(time);
          console.log(`[Player] seekVideo: set currentTime to ${time} for ${elementId}`);
        } else {
          console.warn(`[Player] seekVideo: video element ${elementId} not found or has no player`);
        }
      },
      setVolume: (elementId, volume) => {
        console.log(`[Player] setVolume called for element: ${elementId}, volume: ${volume}`);
        const audio = audioElementsRef.current.get(elementId);
        const video = videoElementsRef.current.get(elementId);
        if (audio) {
          audio.volume = volume;
          console.log(`[Player] setVolume: set audio volume to ${volume} for ${elementId}`);
        }
        if (video && (video as any).player) {
          (video as any).player.volume(volume);
          console.log(`[Player] setVolume: set video volume to ${volume} for ${elementId}`);
        }
        if (!audio && !video) {
          console.warn(`[Player] setVolume: element ${elementId} not found in audio or video registry`);
        }
      },
      setSpeed: (elementId, rate) => {
        console.log(`[Player] setSpeed called for element: ${elementId}, rate: ${rate}`);
        const video = videoElementsRef.current.get(elementId);
        if (video && (video as any).player) {
          (video as any).player.playbackRate(rate);
          console.log(`[Player] setSpeed: set playback rate to ${rate} for ${elementId}`);
        } else {
          console.warn(`[Player] setSpeed: video element ${elementId} not found or has no player`);
        }
      },
      project,
    }),
    [project.scenes]
  );

  // Live interaction-driven overrides clear when the scene changes (a fresh
  // scene starts clean). The idle attract-reset remounts the Player, which also
  // resets via this effect's initial run.
  useEffect(() => {
    overrideStore.reset();
  }, [activeSceneId]);

  const handleTap = useCallback(
    (element: Element) => {
      for (const interaction of element.interactions) {
        if (interaction.trigger === "tap") runInteraction(interaction, ctx);
      }
    },
    [ctx]
  );

  const handleHover = useCallback(
    (element: Element) => {
      for (const interaction of element.interactions) {
        if (interaction.trigger === "hover") {
          runInteraction(interaction, ctx);
        }
      }
    },
    [ctx]
  );

  const handleHoverEnd = useCallback(
    (element: Element) => {
      for (const interaction of element.interactions) {
        if (interaction.trigger === "hoverEnd") {
          runInteraction(interaction, ctx);
        }
      }
    },
    [ctx]
  );

  // Clear binding cache when project changes (BEFORE render uses it).
  // Must happen during render, not in effect (effect runs after render, too late).
  useMemo(() => {
    bindingHost.clearCache();
  }, [project]);

  // Subscribe to bindings and interaction overrides; re-render when they change.
  // Hook must be called unconditionally (Rules of Hooks), even if live=false.
  const resolveBindings = bindingContext.useBindings();
  const getOverrides = useOverrides();

  if (!scene) return <FatalMessage text="Project has no scenes." />;

  // Determine if background is a color or an image path
  const isColor = !scene.background || scene.background.startsWith('#');

  // Build background style
  const backgroundStyle: React.CSSProperties = isColor
    ? { background: scene.background }
    : {
        backgroundImage: `url(${resolveSrc(scene.background, assetBaseUrl)})`,
        backgroundSize: scene.backgroundSize === 'fill' ? '100% 100%' : (scene.backgroundSize || 'cover'),
        backgroundPosition: scene.backgroundPosition || 'center',
        backgroundRepeat: 'no-repeat',
      };

  const onAudioRef = useCallback((elementId: string, ref: HTMLAudioElement | null) => {
    if (ref) {
      audioElementsRef.current.set(elementId, ref);
      console.log(`[Player] Audio element ${elementId} registered`);
    } else {
      audioElementsRef.current.delete(elementId);
      console.log(`[Player] Audio element ${elementId} unregistered`);
    }
  }, []);

  const onVideoRef = useCallback((elementId: string, ref: HTMLVideoElement | null) => {
    if (ref) {
      videoElementsRef.current.set(elementId, ref);
      console.log(`[Player] Video element ${elementId} registered`, {
        hasPlayer: !!(ref as any).player,
        element: ref,
      });
    } else {
      videoElementsRef.current.delete(elementId);
      console.log(`[Player] Video element ${elementId} unregistered`);
    }
  }, []);

  return (
    <ScaledStage width={project.width} height={project.height}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          ...backgroundStyle,
          overflow: "hidden",
        }}
      >
        {scene.elements.map((el) => {
          // Bindings first (live data), then interaction overrides on top.
          const resolved = live
            ? applyOverrides(resolveBindings(el), getOverrides(el.id))
            : el;
          return (
            <ElementRenderer
              key={el.id}
              element={resolved}
              onTap={handleTap}
              onHover={handleHover}
              onHoverEnd={handleHoverEnd}
              assetBaseUrl={assetBaseUrl}
              playing
              onAudioRef={onAudioRef}
              onVideoRef={onVideoRef}
            />
          );
        })}
      </div>
    </ScaledStage>
  );
}

/**
 * Centers a fixed-size stage in the viewport and scales it uniformly to fit
 * (contain), so authored coordinates render identically at any window size.
 */
function ScaledStage({
  width,
  height,
  children,
}: {
  width: number;
  height: number;
  children: React.ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const update = () => {
      const { clientWidth, clientHeight } = host;
      setScale(Math.min(clientWidth / width, clientHeight / height));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(host);
    return () => ro.disconnect();
  }, [width, height]);

  return (
    <div
      ref={hostRef}
      style={{
        position: "absolute",
        inset: 0,
        background: "#000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width,
          height,
          position: "relative",
          transform: `scale(${scale})`,
          transformOrigin: "center center",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function FatalMessage({ text }: { text: string }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#f87171",
        fontFamily: "system-ui, sans-serif",
        fontSize: 24,
        background: "#000",
      }}
    >
      {text}
    </div>
  );
}
