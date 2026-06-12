import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Element, Project, Scene } from "../model/types.js";
import { ElementRenderer } from "./ElementRenderer.js";
import { runInteraction, type PlayerContext } from "../runtime/interactions.js";
import { useBindingValues } from "../data/useBindings.js";
import { resolveBindings } from "../data/applyBindings.js";
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
  const firstSceneId =
    initialSceneId ?? project.startSceneId ?? project.scenes[0]?.id;
  const [activeSceneId, setActiveSceneId] = useState(firstSceneId);

  const scene: Scene | undefined = useMemo(
    () => project.scenes.find((s) => s.id === activeSceneId) ?? project.scenes[0],
    [project, activeSceneId]
  );

  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());

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
      project,
    }),
    [project]
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

  // Subscribe to live data + interaction overrides; re-render when either changes.
  const getValue = useBindingValues();
  const getOverrides = useOverrides();

  if (!scene) return <FatalMessage text="Project has no scenes." />;

  return (
    <ScaledStage width={project.width} height={project.height}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: scene.background,
          overflow: "hidden",
        }}
      >
        {scene.elements.map((el) => {
          // Bindings first (live data), then interaction overrides on top.
          const resolved = live
            ? applyOverrides(resolveBindings(el, getValue), getOverrides(el.id))
            : el;
          return (
            <ElementRenderer
              key={el.id}
              element={resolved}
              onTap={handleTap}
              assetBaseUrl={assetBaseUrl}
              playing
              onAudioRef={(elementId, ref) => {
                if (ref) {
                  audioElementsRef.current.set(elementId, ref);
                } else {
                  audioElementsRef.current.delete(elementId);
                }
              }}
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
