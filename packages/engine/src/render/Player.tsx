import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Element, Project, Scene } from "../model/types.js";
import { ElementRenderer, resolveSrc } from "./ElementRenderer.js";
import { runInteraction, type PlayerContext } from "../runtime/interactions.js";
import { elementResolver, bindingHost, overrideHost } from "../data/ElementResolver.js";
import { createTransitionController } from "../runtime/TransitionController.js";
import { NavigationOverlay } from "./NavigationOverlay.js";
import { eventBus } from "../events/EventBus.js";
import { analyticsStore } from "../analytics/AnalyticsStore.js";
import { AnimationRuntime } from "../runtime/AnimationRuntime.js";
import { StateRuntime } from "../runtime/StateRuntime.js";
import { decomposeValue } from "../runtime/PropertyRegistry.js";
import { imageLoadQueue } from "../runtime/ImageLoadQueue.js";

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
  /** True when rendering in editor mode; disables button interaction overlays. */
  editorMode?: boolean;
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

export function Player({ project, initialSceneId, assetBaseUrl, live = true, hideAudioIcons = false, editorMode = false }: PlayerProps) {
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
  const sessionId = useMemo(() => crypto.randomUUID(), []);
  const sceneEnterTimeRef = useRef<number>(0);

  // Session lifecycle: emit sessionStart on mount, sessionEnd on unmount
  useEffect(() => {
    eventBus.setSessionId(sessionId);
    eventBus.emit({ kind: "sessionStart", payload: {} });
    analyticsStore.init(project.dataConnectors);

    return () => {
      eventBus.emit({ kind: "sessionEnd", payload: {} });
      analyticsStore.flushAll(project.dataConnectors);
      analyticsStore.stop();
      imageLoadQueue.clear(); // Clear queue on Player unmount (session end)
    };
  }, [project.dataConnectors, sessionId]);

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

  // Animation + State runtimes (ADR 0010, ADR 0011)
  const animationRuntime = useMemo(() => new AnimationRuntime(), []);
  const stateRuntime = useMemo(() => new StateRuntime(), []);

  // Wire providers into ElementResolver (rendering pipeline)
  useEffect(() => {
    elementResolver.setStateProvider(stateRuntime);
    elementResolver.setAnimationProvider(animationRuntime);

    // Wire persist callback so animations can write final values to interaction override store
    animationRuntime.setPersistToOverrides((elementId, property, value) => {
      console.log(`[DEBUG-anim] Persist callback invoked:`, { elementId, property, value });

      const decomposed = decomposeValue(property, value);
      for (const [field, val] of Object.entries(decomposed)) {
        overrideHost.setOverride(elementId, field, val);
      }
    });

    return () => {
      elementResolver.setStateProvider(null);
      elementResolver.setAnimationProvider(null);
      animationRuntime.setPersistToOverrides(null);
    };
  }, [animationRuntime, stateRuntime]);

  // Wire element lookup into AnimationRuntime (for resolving current values when from=undefined)
  useEffect(() => {
    const activeScene = sceneLayers[sceneLayers.length - 1]?.scene;
    if (!activeScene) {
      animationRuntime.setElementLookup(null);
      return;
    }

    // Recursive element finder
    const findElement = (elements: Element[], id: string): Element | null => {
      for (const el of elements) {
        if (el.id === id) return el;
        if (el.children) {
          const found = findElement(el.children, id);
          if (found) return found;
        }
      }
      return null;
    };

    animationRuntime.setElementLookup((id) => findElement(activeScene.elements, id));
  }, [sceneLayers, animationRuntime]);

  // Issue 6 fix: Extract transition execution to useCallback
  const executeTransition = useCallback(async (targetScene: Scene, newKey: string) => {
    console.log("[Player] executeTransition called", {
      sceneName: targetScene.name,
      transitionType: targetScene.transition?.type
    });

    const stageEl = stageRef.current;
    if (!stageEl) {
      console.warn("[Player] No stage element");
      return;
    }

    const containers = stageEl.querySelectorAll<HTMLDivElement>('[data-scene-container]');
    console.log("[Player] Found containers:", containers.length);

    if (containers.length < 2) {
      console.warn("[Player] Expected 2 scene containers for transition, found", containers.length);
      setSceneLayers([{ scene: targetScene, key: newKey }]);
      setIsTransitioning(false);
      return;
    }

    const outgoingEl = containers[containers.length - 2];
    const incomingEl = containers[containers.length - 1];

    console.log("[Player] Starting transition animation");
    await transitionControllerRef.current.transitionTo(
      targetScene,
      stageEl,
      outgoingEl,
      incomingEl,
      project.width,
      project.height
    );
    console.log("[Player] Transition animation complete");

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

    // Emit sceneExit with duration
    if (sceneEnterTimeRef.current > 0) {
      const duration = Date.now() - sceneEnterTimeRef.current;
      eventBus.emit({
        kind: "sceneExit",
        payload: { sceneId: currentSceneId, duration }
      });
    }

    // Skip transition if no transition defined
    if (!targetScene.transition || targetScene.transition.type === "none") {
      console.log("[Player] Skipping transition - none defined", {
        sceneName: targetScene.name,
        hasTransition: !!targetScene.transition,
        transitionType: targetScene.transition?.type
      });

      // Update scene tracking and emit sceneEnter
      sceneEnterTimeRef.current = Date.now();
      eventBus.setCurrentScene(targetScene.id);
      eventBus.emit({
        kind: "sceneEnter",
        payload: { sceneId: targetScene.id, sceneName: targetScene.name }
      });

      setSceneLayers([{ scene: targetScene, key: `${targetScene.id}-${++keyCounterRef.current}` }]);
      return;
    }

    // Update scene tracking and emit sceneEnter
    sceneEnterTimeRef.current = Date.now();
    eventBus.setCurrentScene(targetScene.id);
    eventBus.emit({
      kind: "sceneEnter",
      payload: { sceneId: targetScene.id, sceneName: targetScene.name }
    });

    // Run transition
    console.log("[Player] Starting transition flow", {
      sceneName: targetScene.name,
      transitionType: targetScene.transition?.type
    });

    setIsTransitioning(true);
    const newKey = `${targetScene.id}-${++keyCounterRef.current}`;
    setSceneLayers((prev) => [...prev, { scene: targetScene, key: newKey }]);

    // Wait for render, then run transition (double rAF ensures paint completes)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        executeTransition(targetScene, newKey);
      });
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
      animate: async (elementId, property, from, to, duration, easing, delay) => {
        console.log(`[DEBUG-anim] PlayerContext.animate() wrapper called:`, {
          elementId,
          property,
          from,
          to,
          duration,
          easing,
          delay,
        });
        const result = await animationRuntime.animate(elementId, property, from, to, duration, easing, delay);
        console.log(`[DEBUG-anim] PlayerContext.animate() wrapper completed`);
        return result;
      },
      setState: async (stateName, animated, duration) => {
        if (animated) {
          // Fade out, swap state, fade in
          const activeScene = sceneLayers[sceneLayers.length - 1]?.scene;
          if (!activeScene) return;

          // TODO: Implement fade transition (opacity tween on all elements)
          // For v1, just instant swap
          console.warn("[Player] setState animated transitions not yet implemented, falling back to instant");
        }
        // Pass scene ID to validate state applies to correct scene
        const sceneId = sceneLayers[sceneLayers.length - 1]?.scene.id;
        stateRuntime.setState(stateName, sceneId);
        // Wait for React to apply changes before continuing
        await new Promise(resolve => requestAnimationFrame(resolve));
      },
      project,
    };

  // Issue 3 fix: Extract active scene ID as scalar to prevent mid-transition resets
  const activeSceneId = sceneLayers[sceneLayers.length - 1]?.scene.id;
  const activeScene = sceneLayers[sceneLayers.length - 1]?.scene;

  // Live interaction-driven overrides clear when the scene changes (a fresh
  // scene starts clean). The idle attract-reset remounts the Player, which also
  // resets via this effect's initial run.
  useEffect(() => {
    overrideHost.resetOverrides();
    animationRuntime.cancelAll();
    // NOTE: Don't clear imageLoadQueue here - it's cleared in goToSceneInternal
    // after transitions complete to avoid unloading images mid-transition
  }, [activeSceneId, animationRuntime]);

  // Keep StateRuntime's scene data fresh on every project update (editor edits,
  // re-validation, etc.) without clobbering an active state — setScene only
  // clears activeStateName when the scene id actually changes.
  useEffect(() => {
    if (activeScene) {
      stateRuntime.setScene(activeScene);
    }
  }, [activeScene, stateRuntime]);

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

    // Run enterScene interactions sequentially to avoid setState races
    const runEnterSceneInteractions = async () => {
      for (const element of allElements) {
        for (const interaction of element.interactions) {
          if (interaction.trigger === "enterScene") {
            await runInteraction(interaction, ctx, element);
          }
        }
      }
    };
    runEnterSceneInteractions();

    firedEnterSceneRef.current.add(layerKey);
  }, [sceneLayers, isTransitioning, ctx]);

  const handleTap = useCallback(
    async (element: Element) => {
      console.log(`[DEBUG-anim] handleTap() called for element:`, {
        elementId: element.id,
        elementType: element.type,
        interactionsCount: element.interactions.length,
      });
      const tapInteractions = element.interactions.filter(i => i.trigger === "tap");
      console.log(`[DEBUG-anim] Found ${tapInteractions.length} tap interactions`);
      // Run sequentially to avoid setState races
      for (const interaction of tapInteractions) {
        console.log(`[DEBUG-anim] Running tap interaction:`, {
          interactionId: interaction.id,
          actionsCount: interaction.actions.length,
        });
        await runInteraction(interaction, ctx, element);
      }
    },
    [ctx]
  );

  const handleHover = useCallback(
    async (element: Element) => {
      // Run sequentially to avoid setState races
      for (const interaction of element.interactions) {
        if (interaction.trigger === "hover") {
          await runInteraction(interaction, ctx, element);
        }
      }
    },
    [ctx]
  );

  const handleHoverEnd = useCallback(
    async (element: Element) => {
      // Run sequentially to avoid setState races
      for (const interaction of element.interactions) {
        if (interaction.trigger === "hoverEnd") {
          await runInteraction(interaction, ctx, element);
        }
      }
    },
    [ctx]
  );

  const handlePress = useCallback(
    async (element: Element) => {
      // Run sequentially to avoid setState races
      for (const interaction of element.interactions) {
        if (interaction.trigger === "press") {
          await runInteraction(interaction, ctx, element);
        }
      }
    },
    [ctx]
  );

  const handleRelease = useCallback(
    async (element: Element) => {
      // Run sequentially to avoid setState races
      for (const interaction of element.interactions) {
        if (interaction.trigger === "release") {
          await runInteraction(interaction, ctx, element);
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

  // Progressive rendering: mount elements in batches to reduce initial load time
  const BATCH_SIZE = 12; // Elements per batch
  const INITIAL_BATCH = 12; // First batch renders immediately
  const [mountedCount, setMountedCount] = useState<Map<string, number>>(new Map());

  // Get or initialize mounted count for current scene layer
  const activeLayerKey = sceneLayers[sceneLayers.length - 1]?.key ?? "";
  const currentMountedCount = mountedCount.get(activeLayerKey) ?? INITIAL_BATCH;

  // Reset mounted count when scene changes
  useEffect(() => {
    if (activeLayerKey && !mountedCount.has(activeLayerKey)) {
      setMountedCount((prev) => new Map(prev).set(activeLayerKey, INITIAL_BATCH));
    }
  }, [activeLayerKey]);

  // Schedule next batch of elements to mount
  useEffect(() => {
    const activeLayer = sceneLayers[sceneLayers.length - 1];
    if (!activeLayer) return;

    const totalElements = activeLayer.scene.elements.length;
    const mounted = currentMountedCount;

    // All elements already mounted
    if (mounted >= totalElements) return;

    // Schedule next batch using requestIdleCallback (falls back to setTimeout)
    const scheduleNextBatch = () => {
      const nextCount = Math.min(mounted + BATCH_SIZE, totalElements);
      setMountedCount((prev) => new Map(prev).set(activeLayer.key, nextCount));
    };

    // Use requestIdleCallback if available, otherwise setTimeout
    if (typeof requestIdleCallback !== "undefined") {
      const handle = requestIdleCallback(scheduleNextBatch, { timeout: 50 });
      return () => cancelIdleCallback(handle);
    } else {
      const handle = setTimeout(scheduleNextBatch, 16); // ~1 frame
      return () => clearTimeout(handle);
    }
  }, [activeLayerKey, currentMountedCount, sceneLayers]);

  // Collect all masks from scene elements (recursive)
  function collectMasks(elements: Element[]): Array<{ id: string; mask: Element["mask"] }> {
    const masks: Array<{ id: string; mask: Element["mask"] }> = [];
    for (const el of elements) {
      if (el.type === "layer" && el.mask) {
        masks.push({ id: el.id, mask: el.mask });
      }
      if (el.children) {
        masks.push(...collectMasks(el.children));
      }
    }
    return masks;
  }

  const sceneElements = sceneLayers.map((layer) => {
    const { scene, key } = layer;
    const sceneMasks = collectMasks(scene.elements);

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

    // Hide incoming scene container until transition starts (prevents flash)
    const isIncomingScene = isTransitioning && layer === sceneLayers[sceneLayers.length - 1];

    return (
      <div
        key={key}
        data-scene-container
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: project.width,
          height: project.height,
          ...backgroundStyle,
          overflow: "hidden",
          ...(isIncomingScene && { display: "none" }),
        }}
      >
        {/* Consolidated SVG defs for all layer masks in this scene */}
        {sceneMasks.length > 0 && (
          <svg
            width={project.width}
            height={project.height}
            viewBox={`0 0 ${project.width} ${project.height}`}
            style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', opacity: 0 }}
          >
            <defs>
              {sceneMasks.map(({ id, mask }) => {
                if (!mask) return null;
                const clipPathId = `mask-${id}`;
                return (
                  <clipPath key={id} id={clipPathId} clipPathUnits="userSpaceOnUse">
                    {mask.type === 'rect' ? (
                      <rect
                        x={mask.points[0][0]}
                        y={mask.points[0][1]}
                        width={mask.points[1][0] - mask.points[0][0]}
                        height={mask.points[1][1] - mask.points[0][1]}
                      />
                    ) : (
                      <polygon points={mask.points.map(p => `${p[0]},${p[1]}`).join(' ')} />
                    )}
                  </clipPath>
                );
              })}
            </defs>
          </svg>
        )}
        <div className="scene-elements" style={{ position: "absolute", inset: 0 }}>
          {scene.elements.slice(0, currentMountedCount).map((el) => {
            // Unified resolution: bindings + overrides in one call.
            const resolved = live ? resolveElement(el) : el;

            // Enforce fullscreen geometry for layers
            const layerEnforced = resolved.type === "layer"
              ? { ...resolved, x: 0, y: 0, width: project.width, height: project.height }
              : resolved;

            // Force audio elements to opacity: 1 in play/kiosk mode
            const finalElement = layerEnforced.type === "audio"
              ? { ...layerEnforced, opacity: 1 }
              : layerEnforced;

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
                onPress={handlePress}
                onRelease={handleRelease}
                assetBaseUrl={assetBaseUrl}
                playing
                onAudioRef={onAudioRef}
                onVideoRef={onVideoRef}
                editorMode={editorMode}
                resolveElement={live ? resolveElement : undefined}
              />
            );
          })}
        </div>
      </div>
    );
  });

  return (
    <ScaledStage
      width={project.width}
      height={project.height}
      stageRef={stageRef}
      navigationOverlay={
        hideAudioIcons ? (
          <NavigationOverlay
            project={project}
            currentSceneId={currentSceneId}
            navigationHistory={navigationHistory}
            onBack={ctx.goBack}
            onHome={() => homeSceneId && ctx.goToScene(homeSceneId)}
          />
        ) : null
      }
    >
      {sceneElements}
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
  navigationOverlay,
  children,
}: {
  width: number;
  height: number;
  stageRef: React.RefObject<HTMLDivElement>;
  navigationOverlay?: React.ReactNode;
  children: React.ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const update = () => {
      const { clientWidth, clientHeight } = host;
      const newScale = Math.min(clientWidth / width, clientHeight / height);

      // Calculate offset to center the scaled stage
      // Scaled dimensions: width * scale, height * scale
      // Center offset: (viewport - scaled) / 2
      const offsetX = (clientWidth - width * newScale) / 2;
      const offsetY = (clientHeight - height * newScale) / 2;

      setScale(newScale);
      setOffset({ x: offsetX, y: offsetY });
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
        overflow: "hidden",
      }}
    >
      <div
        ref={stageRef}
        style={{
          width,
          height,
          position: "absolute",
          left: 0,
          top: 0,
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        {children}
      </div>
      {/* Navigation overlay rendered outside the scaled stage for correct positioning */}
      {navigationOverlay}
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
