import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Element, Project, Scene } from "../model/types.js";
import { ElementRenderer, resolveSrc } from "./ElementRenderer.js";
import { runInteraction, type PlayerContext } from "../runtime/interactions.js";
import { elementResolver, bindingHost, overrideHost } from "../data/ElementResolver.js";
import { createTransitionController } from "../runtime/TransitionController.js";
import { NavigationOverlay } from "./NavigationOverlay.js";

export interface PlayerProps {
  project: Project;
  /** Override the starting scene (defaults to project.startSceneId or first). */
  initialSceneId?: string;
  /** Base URL for resolving relative asset paths (see ElementRenderer). */
  assetBaseUrl?: string;
  /** Apply live data bindings (default true). */
  live?: boolean;
  /** Hide audio element icons (for play/kiosk mode, not editor preview). */
  hideAudioIcons?: boolean;
}

/**
 * The Player renders a Project and runs its interactions. It owns the
 * "which scene is active" state and scales the fixed scene resolution to fit
 * the available space (letterboxed), the way a kiosk authored at 1920x1080
 * should display on any screen.
 */
interface SceneLayer {
  scene: Scene;
  key: string;
}

export function Player({ project, initialSceneId, assetBaseUrl, live = true, hideAudioIcons = false }: PlayerProps) {
  // console.log('New player element created.')
  const firstSceneId =
    initialSceneId ?? project.startSceneId ?? project.scenes[0]?.id;
  const firstScene = project.scenes.find((s) => s.id === firstSceneId) ?? project.scenes[0];

  const [sceneLayers, setSceneLayers] = useState<SceneLayer[]>([
    { scene: firstScene!, key: `${firstScene!.id}-0` }
  ]);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [navigationHistory, setNavigationHistory] = useState<string[]>([]);

  const keyCounterRef = useRef(0);

  // Sync initialSceneId prop changes (for Canvas scene switching)
  // Issue 1 fix: Removed sceneLayers from deps to prevent infinite loop
  // Issue 5 fix: Use stable counter instead of Date.now()
  useEffect(() => {
    const currentSceneId = sceneLayers[sceneLayers.length - 1]?.scene.id;
    if (initialSceneId && initialSceneId !== currentSceneId) {
      const targetScene = project.scenes.find((s) => s.id === initialSceneId);
      if (targetScene) {
        setSceneLayers([{ scene: targetScene, key: `${targetScene.id}-${++keyCounterRef.current}` }]);
      }
    }
  }, [initialSceneId, project.scenes]);

  // Sync project prop changes (for Canvas editor: element moves, property edits)
  useEffect(() => {
    const currentSceneId = sceneLayers[sceneLayers.length - 1]?.scene.id;
    if (!currentSceneId) return;

    const updatedScene = project.scenes.find((s) => s.id === currentSceneId);
    if (!updatedScene) return;

    // Update the active scene layer with latest data
    setSceneLayers((prev) => {
      const updated = [...prev];
      updated[updated.length - 1] = {
        ...updated[updated.length - 1],
        scene: updatedScene,
      };
      return updated;
    });
  }, [project]);

  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const videoElementsRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const transitionControllerRef = useRef(createTransitionController());
  const stageRef = useRef<HTMLDivElement>(null);
  const hasLoadedHomeSceneRef = useRef(false);

  // Issue 6 fix: Extract transition execution to useCallback
  const executeTransition = useCallback(async (targetScene: Scene, newKey: string) => {
    const stageEl = stageRef.current;
    if (!stageEl) return;

    const containers = stageEl.querySelectorAll<HTMLDivElement>('[data-scene-container]');
    if (containers.length < 2) {
      console.warn("[Player] Expected 2 scene containers for transition");
      setSceneLayers([{ scene: targetScene, key: newKey }]);
      setIsTransitioning(false);
      return;
    }

    const outgoingEl = containers[containers.length - 2];
    const incomingEl = containers[containers.length - 1];

    await transitionControllerRef.current.transitionTo(
      targetScene,
      stageEl,
      outgoingEl,
      incomingEl,
      project.width,
      project.height
    );

    // Remove outgoing scene
    setSceneLayers([{ scene: targetScene, key: newKey }]);
    setIsTransitioning(false);
  }, []);

  // Internal navigation with history control
  const goToSceneInternal = useCallback(async (sceneId: string, pushToHistory: boolean) => {
    if (isTransitioning || transitionControllerRef.current.state === "transitioning") {
      console.warn("[Player] goToScene ignored: transition in progress");
      return;
    }

    const targetScene = project.scenes.find((s) => s.id === sceneId);
    if (!targetScene) {
      console.warn(`[Player] goToScene: scene ${sceneId} not found`);
      return;
    }

    const homeSceneId = project.startSceneId ?? project.scenes[0]?.id;
    const currentSceneId = sceneLayers[sceneLayers.length - 1]?.scene.id;

    // Push current scene to history if requested and not navigating to home
    if (pushToHistory && currentSceneId && sceneId !== homeSceneId) {
      setNavigationHistory((h) => [...h, currentSceneId]);
    }

    // Clear history when arriving at home scene
    if (sceneId === homeSceneId) {
      setNavigationHistory([]);
    }

    // Skip transition for first home scene load or if no transition defined
    const isFirstHomeSceneLoad = targetScene.id === homeSceneId && !hasLoadedHomeSceneRef.current;

    if (isFirstHomeSceneLoad || !targetScene.transition || targetScene.transition.type === "none") {
      if (isFirstHomeSceneLoad) {
        hasLoadedHomeSceneRef.current = true;
      }
      setSceneLayers([{ scene: targetScene, key: `${targetScene.id}-${++keyCounterRef.current}` }]);
      return;
    }

    // Run transition
    setIsTransitioning(true);
    const newKey = `${targetScene.id}-${++keyCounterRef.current}`;
    setSceneLayers((prev) => [...prev, { scene: targetScene, key: newKey }]);

    // Wait for render, then run transition
    requestAnimationFrame(() => {
      executeTransition(targetScene, newKey);
    });
  }, [isTransitioning, project, sceneLayers, executeTransition]);

  // Issue 2 fix: Remove useMemo to prevent stale closures
  // ctx object is cheap to create, no need for memoization
  const ctx: PlayerContext = {
    goToScene: async (sceneId) => {
      goToSceneInternal(sceneId, true);
    },
    goBack: () => {
      if (navigationHistory.length === 0) return;
      const previousSceneId = navigationHistory[navigationHistory.length - 1];
      setNavigationHistory((h) => h.slice(0, -1));
      goToSceneInternal(previousSceneId, false);
    },
      setProp: (elementId, key, value) => overrideHost.setOverride(elementId, key, value),
      toggleVisibility: (elementId) => overrideHost.toggleOverride(elementId, "__hidden"),
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
        const video = videoElementsRef.current.get(elementId);
        if (!video) {
          console.warn(`[Player] togglePlayVideo: video element ${elementId} not found`);
          return;
        }

        if (video.paused) {
          video.play().catch((err) => console.warn(`[Player] Play failed for ${elementId}:`, err));
        } else {
          video.pause();
        }
      },
      seekVideo: (elementId, time) => {
        const video = videoElementsRef.current.get(elementId);
        if (video) {
          video.currentTime = time;
        } else {
          console.warn(`[Player] seekVideo: video element ${elementId} not found`);
        }
      },
      setVolume: (elementId, volume) => {
        const audio = audioElementsRef.current.get(elementId);
        const video = videoElementsRef.current.get(elementId);
        if (audio) {
          audio.volume = volume;
        }
        if (video) {
          video.volume = volume;
        }
        if (!audio && !video) {
          console.warn(`[Player] setVolume: element ${elementId} not found`);
        }
      },
      setSpeed: (elementId, rate) => {
        const video = videoElementsRef.current.get(elementId);
        if (video) {
          video.playbackRate = rate;
        } else {
          console.warn(`[Player] setSpeed: video element ${elementId} not found`);
        }
      },
      project,
    };

  // Issue 3 fix: Extract active scene ID as scalar to prevent mid-transition resets
  const activeSceneId = sceneLayers[sceneLayers.length - 1]?.scene.id;

  // Live interaction-driven overrides clear when the scene changes (a fresh
  // scene starts clean). The idle attract-reset remounts the Player, which also
  // resets via this effect's initial run.
  useEffect(() => {
    overrideHost.resetOverrides();
  }, [activeSceneId]);

  // Track which scene entries have already fired enterScene interactions.
  // Keys are scene layer keys (e.g., "scene2-5"), which are unique per entry
  // even if the same scene is visited multiple times.
  const firedEnterSceneRef = useRef<Set<string>>(new Set());

  // Fire enterScene interactions when a scene becomes active.
  // Per ADR 0001, these fire after transitions complete, not during.
  useEffect(() => {
    const activeLayer = sceneLayers[sceneLayers.length - 1];
    if (!activeLayer) return;

    const layerKey = activeLayer.key;

    // Don't fire during transitions (wait for completion)
    if (isTransitioning) return;

    // Don't fire if already fired for this scene entry
    if (firedEnterSceneRef.current.has(layerKey)) return;

    const scene = activeLayer.scene;

    // Recursively collect all elements (including children in groups/collections)
    const collectAllElements = (elements: Element[]): Element[] => {
      const result: Element[] = [];
      for (const el of elements) {
        result.push(el);
        if (el.children && el.children.length > 0) {
          result.push(...collectAllElements(el.children));
        }
      }
      return result;
    };

    const allElements = collectAllElements(scene.elements);

    // Run enterScene interactions on all elements in the scene
    for (const element of allElements) {
      for (const interaction of element.interactions) {
        if (interaction.trigger === "enterScene") {
          runInteraction(interaction, ctx);
        }
      }
    }

    firedEnterSceneRef.current.add(layerKey);
  }, [sceneLayers, isTransitioning, ctx]);

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
  // useLayoutEffect runs synchronously after DOM mutations but before browser paint.
  // This ensures cache clears before elements render with bindings.
  useLayoutEffect(() => {
    bindingHost.clearCache();
  }, [project]);

  // Subscribe to element resolution (bindings + overrides); re-render when they change.
  // Hook must be called unconditionally (Rules of Hooks), even if live=false.
  const resolveElement = elementResolver.useResolveElement();

  if (sceneLayers.length === 0) return <FatalMessage text="Project has no scenes." />;

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

  const currentSceneId = sceneLayers[sceneLayers.length - 1]?.scene.id ?? "";
  const homeSceneId = project.startSceneId ?? project.scenes[0]?.id;

  return (
    <ScaledStage width={project.width} height={project.height} stageRef={stageRef}>
      {sceneLayers.map((layer) => {
        const { scene, key } = layer;

        // Issue 4 fix: Apply explicit fallback to prevent undefined backgrounds
        const background = scene.background || "#000000";
        const isColor = background.startsWith('#');

        // Build background style
        const backgroundStyle: React.CSSProperties = isColor
          ? { background }
          : {
              backgroundImage: `url(${resolveSrc(background, assetBaseUrl)})`,
              backgroundSize: scene.backgroundSize === 'fill' ? '100% 100%' : (scene.backgroundSize || 'cover'),
              backgroundPosition: scene.backgroundPosition || 'center',
              backgroundRepeat: 'no-repeat',
            };

        return (
          <div
            key={key}
            data-scene-container
            style={{
              position: "absolute",
              inset: 0,
              ...backgroundStyle,
              overflow: "hidden",
            }}
          >
            <div className="scene-elements" style={{ position: "absolute", inset: 0 }}>
              {scene.elements.map((el) => {
                // Unified resolution: bindings + overrides in one call.
                const resolved = live ? resolveElement(el) : el;

                // Force audio elements to opacity: 0 in play/kiosk mode
                const finalElement = resolved.type === "audio"
                  ? { ...resolved, opacity: 1 }
                  : resolved;

                if (resolved.type === "audio") {
                  console.log('[Player] Audio element opacity:', finalElement.opacity);
                }

                return (
                  <ElementRenderer
                    key={el.id}
                    element={finalElement}
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
          </div>
        );
      })}

      {/* Navigation overlay (only in Play/Kiosk mode) */}
      {hideAudioIcons && (
        <NavigationOverlay
          project={project}
          currentSceneId={currentSceneId}
          navigationHistory={navigationHistory}
          onBack={ctx.goBack}
          onHome={() => homeSceneId && ctx.goToScene(homeSceneId)}
        />
      )}
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
  stageRef,
  children,
}: {
  width: number;
  height: number;
  stageRef: React.RefObject<HTMLDivElement>;
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
        ref={stageRef}
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
